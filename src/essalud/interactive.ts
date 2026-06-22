/**
 * Modo interactivo de EsSalud — menú estilo command palette usando @clack/prompts.
 * Se lanza cuando se corre `essalud` sin subcomando.
 */

import { readFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import boxen from "boxen";
import figlet from "figlet";
import pc from "picocolors";
import {
  type ActSubAct,
  type CitaEmitida,
  type Cupo,
  type CupoSlot,
  generarCita,
  getCitasEmitidas,
  getPaciente,
  getParametroSolicitud,
  getPerfil,
  getProgramacionDisponible,
  type Perfil,
  request,
  type ServicioHosp,
  TOKEN_PATH,
} from "./api.js";
import { cmdLogin } from "./cmd-login.js";
import { decodeJwtPayload } from "./jwt.js";

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

interface TokenStatus {
  valid: boolean;
  expired: boolean;
  expiresAt: Date | null;
  token: string | null;
}

async function getTokenStatus(): Promise<TokenStatus> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    const token = raw.trim();
    if (!token.startsWith("ey")) {
      return { valid: false, expired: false, expiresAt: null, token: null };
    }
    const payload = decodeJwtPayload(token);
    if (payload && typeof payload.exp === "number") {
      const expiresAt = new Date(payload.exp * 1000);
      const expired = Date.now() > payload.exp * 1000;
      return { valid: true, expired, expiresAt, token };
    }
    // JWT sin exp legible: lo tratamos como válido sin info de expiración.
    return { valid: true, expired: false, expiresAt: null, token };
  } catch {
    return { valid: false, expired: false, expiresAt: null, token: null };
  }
}

// ---------------------------------------------------------------------------
// Banner de bienvenida
// ---------------------------------------------------------------------------

function printWordmark(): void {
  try {
    const art = figlet.textSync("essalud", { font: "ANSI Shadow" });
    console.log(pc.cyan(art));
  } catch {
    // Fallback si figlet falla por alguna razón
    console.log(pc.cyan("\n  essalud\n"));
  }
}

async function printBanner(ts: TokenStatus): Promise<void> {
  printWordmark();

  const paciente = await getPaciente();

  // Saludo
  const nombreMostrado = paciente?.nombres?.trim() || paciente?.apePaterno?.trim() || null;
  const saludoLine = nombreMostrado ? `Hola, ${nombreMostrado}` : "Hola";

  // Estado del token
  let estadoLine: string;
  if (!ts.valid || !ts.token) {
    estadoLine = pc.yellow("no logueada — corre login");
  } else if (ts.expired) {
    estadoLine = pc.red("VENCIDO — corre login");
  } else {
    // Extraer DNI del JWT (sub) o mostrar genérico
    const payload = decodeJwtPayload(ts.token ?? "");
    const dni =
      (typeof payload?.sub === "string" && payload.sub) ||
      (typeof payload?.username === "string" && payload.username) ||
      (typeof payload?.preferred_username === "string" && payload.preferred_username) ||
      "";
    const dniStr = dni ? ` · DNI ${dni}` : "";
    const venceStr = ts.expiresAt
      ? ` · vence ${ts.expiresAt.toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" })}`
      : "";
    estadoLine = pc.green(`logueada${dniStr}${venceStr}`);
  }

  // Centro
  const centroLine = paciente?.desCentro
    ? `Centro: ${paciente.desCentro}`
    : "Centro: (desconocido — corre login)";

  const content = [
    pc.bold("essalud · citas EsSalud"),
    "",
    saludoLine,
    estadoLine,
    centroLine,
    "",
    pc.dim("Elige una opción ↓"),
  ].join("\n");

  console.log(
    boxen(content, {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: "round",
      borderColor: "#E8845A",
      textAlignment: "center",
    }),
  );
}

// ---------------------------------------------------------------------------
// Guard: exige login activo
// ---------------------------------------------------------------------------

async function requireLogin(ts: TokenStatus): Promise<boolean> {
  if (ts.valid && !ts.expired) return true;
  p.log.warn(
    ts.expired
      ? "Tu token venció. Necesitas hacer login nuevamente."
      : "No hay sesión activa. Primero haz login.",
  );
  const ir = await p.confirm({ message: "¿Quieres hacer login ahora?" });
  if (p.isCancel(ir) || !ir) return false;
  await runLogin();
  return true;
}

// ---------------------------------------------------------------------------
// Subrutinas de cada opción del menú
// ---------------------------------------------------------------------------

async function runLogin(): Promise<void> {
  p.log.info("Iniciando login...");
  try {
    await cmdLogin({});
  } catch (err) {
    p.log.error(String(err));
  }
}

async function runPerfil(ts: TokenStatus): Promise<void> {
  if (!(await requireLogin(ts))) return;
  const s = p.spinner();
  s.start("Cargando perfil...");
  try {
    const [perfil, paciente] = await Promise.all([getPerfil(), getPaciente()]);
    s.stop("Perfil cargado.");
    printPerfil(perfil, paciente);
  } catch (err) {
    s.stop("Error al cargar el perfil.");
    p.log.error(String(err));
  }
}

function printPerfil(perfil: Perfil, paciente: Awaited<ReturnType<typeof getPaciente>>): void {
  // /perfil trae nombre separado; enricher con paciente.json si hay
  const nombreApi = [
    perfil.apellidoPatAsegurado,
    perfil.apellidoMatAsegurado,
    perfil.nombreAsegurado,
  ]
    .filter(Boolean)
    .join(" ");
  const nombrePaciente = paciente
    ? [paciente.apePaterno, paciente.apeMaterno, paciente.nombres].filter(Boolean).join(" ")
    : "";
  const nombre = nombrePaciente || nombreApi || "(sin datos)";

  const centro = paciente?.desCentro ?? "—";
  const contacto = perfil.contacto;

  p.note(
    [
      `Nombre   : ${nombre}`,
      `Centro   : ${centro}`,
      `DNI      : ${perfil.numeroDocIdent ?? "—"}`,
      `Celular  : ${contacto?.nroCelular ?? paciente?.celular ?? "—"}`,
      `Email    : ${contacto?.email ?? paciente?.email ?? "—"}`,
    ].join("\n"),
    "Mi perfil",
  );
}

async function runCitas(ts: TokenStatus): Promise<void> {
  if (!(await requireLogin(ts))) return;
  const s = p.spinner();
  s.start("Cargando citas...");
  try {
    const citas = await getCitasEmitidas();
    s.stop(`${citas.length} cita(s) encontrada(s).`);
    if (citas.length === 0) {
      p.log.info("No tienes citas programadas.");
      return;
    }
    printCitas(citas);
  } catch (err) {
    s.stop("Error al cargar las citas.");
    p.log.error(String(err));
  }
}

function printCitas(citas: CitaEmitida[]): void {
  const lines = citas.map((c, i) => {
    const fecha = c.citFecha ?? "—";
    const hora = c.citHora ?? "—";
    const centro = c.citCenAsiDes ?? "—";
    const estado = c.citEstCita ?? "—";
    const id = c.citActMedNum ?? c.citAutoGenCod ?? "—";
    return `${i + 1}. [${id}] ${fecha} ${hora} · ${centro} · ${estado}`;
  });
  p.note(lines.join("\n"), "Mis citas");
}

// ---------------------------------------------------------------------------
// Reservar cita — flujo guiado
// ---------------------------------------------------------------------------

async function runReservar(ts: TokenStatus): Promise<void> {
  if (!(await requireLogin(ts))) return;

  // --- Paso 1: centro — tomarlo de paciente.json sin preguntar ---
  const paciente = await getPaciente();
  let codCentro: string;
  if (paciente?.codCentro) {
    codCentro = paciente.codCentro;
    p.log.info(`Centro: ${paciente.desCentro} (${codCentro})`);
  } else {
    // Fallback: preguntar solo si no hay paciente.json
    const codCentroRaw = await p.text({
      message: "Código de tu centro de adscripción (Enter para usar 021, tu centro default)",
      placeholder: "021",
      defaultValue: "021",
    });
    if (p.isCancel(codCentroRaw)) return;
    codCentro = (codCentroRaw as string).trim() || "021";
  }

  // --- Paso 2: especialidades ---
  const s1 = p.spinner();
  s1.start("Consultando especialidades...");
  let servicios: ServicioHosp[] = [];
  try {
    const data = await getParametroSolicitud(codCentro);
    servicios = data.dataParmServicioHosp ?? [];
    s1.stop(`${servicios.length} especialidad(es) disponible(s).`);
  } catch (err) {
    s1.stop("Error al consultar especialidades.");
    p.log.error(String(err));
    return;
  }

  if (servicios.length === 0) {
    p.log.warn("No se encontraron especialidades para ese centro.");
    return;
  }

  const servicioOptions = servicios.map((sv) => ({
    value: sv.codServicioHosp,
    label: sv.desServicioHosp,
    hint: sv.codServicioHosp,
  }));

  const codServicioHosp = await p.select<string>({
    message: "Elige la especialidad",
    options: servicioOptions,
  });
  if (p.isCancel(codServicioHosp)) return;

  const servicioElegido = servicios.find((sv) => sv.codServicioHosp === codServicioHosp);
  if (!servicioElegido) return;

  // --- Paso 3: actividad (si hay más de una) ---
  let codActSubAct: string;
  const actividades = servicioElegido.vdataActSubAct ?? [];

  if (actividades.length === 0) {
    p.log.warn("Esta especialidad no tiene actividades configuradas.");
    return;
  } else if (actividades.length === 1 && actividades[0]) {
    codActSubAct = actividades[0].codActSubAct;
    p.log.info(`Actividad: ${actividades[0].desSubActHosp}`);
  } else {
    const actOpts = actividades.map((a: ActSubAct) => ({
      value: a.codActSubAct,
      label: a.desSubActHosp,
      hint: a.desActHosp ?? a.codActSubAct,
    }));
    const chosenAct = await p.select<string>({
      message: "Elige la actividad",
      options: actOpts,
    });
    if (p.isCancel(chosenAct)) return;
    codActSubAct = chosenAct as string;
  }

  // --- Paso 4: cupos disponibles ---
  const s2 = p.spinner();
  s2.start("Buscando cupos disponibles...");
  let cupos: Cupo[] = [];
  try {
    cupos = await getProgramacionDisponible({
      codCentro,
      codServicioHosp: codServicioHosp as string,
      codActSubAct,
      codTurnoDeseado: "0",
    });
    s2.stop(`${cupos.length} cupo(s) disponible(s).`);
  } catch (err) {
    s2.stop("Error al consultar cupos.");
    p.log.error(String(err));
    return;
  }

  if (cupos.length === 0) {
    p.log.warn("Sin programación disponible para esta especialidad/actividad. Intenta otra.");
    return;
  }

  // Aplanar cupos × slots para que cada opción sea única
  interface SlotOpcion {
    cupo: Cupo;
    slot: CupoSlot;
  }
  const opciones: SlotOpcion[] = [];
  for (const cupo of cupos) {
    for (const slot of cupo.vCupoDisp ?? []) {
      opciones.push({ cupo, slot });
    }
  }

  if (opciones.length === 0) {
    p.log.warn("Los cupos no tienen slots disponibles.");
    return;
  }

  const slotOpts = opciones.map((o, i) => ({
    value: String(i),
    label: `${o.cupo.apeNomProf} — ${o.cupo.fechaCitaProg} ${o.slot.hora}`,
    hint: `Cupo #${o.slot.nroCupo} · Consul. ${o.cupo.consultorio}`,
  }));

  const chosenSlotIdx = await p.select<string>({
    message: "Elige un cupo",
    options: slotOpts,
  });
  if (p.isCancel(chosenSlotIdx)) return;

  const elegido = opciones[Number(chosenSlotIdx)];
  if (!elegido) return;

  // --- Paso 5: resumen + confirmación ---
  p.note(
    [
      `Profesional : ${elegido.cupo.apeNomProf}`,
      `Fecha       : ${elegido.cupo.fechaCitaProg}`,
      `Hora        : ${elegido.slot.hora}`,
      `Cupo #      : ${elegido.slot.nroCupo}`,
      `Consultorio : ${elegido.cupo.consultorio}`,
      `Especialidad: ${servicioElegido.desServicioHosp}`,
    ].join("\n"),
    "Resumen de la cita",
  );

  const confirma = await p.confirm({
    message: "¿Reservar esta cita REAL? (ocupa un cupo real en EsSalud)",
    initialValue: false,
  });
  if (p.isCancel(confirma) || !confirma) {
    p.log.info("Reserva cancelada. No se realizó ninguna acción.");
    return;
  }

  // --- Paso 6: obtener datos de contacto del perfil ---
  const s3 = p.spinner();
  s3.start("Obteniendo datos de contacto...");
  let numCelular = "";
  let email = "";
  try {
    const perfil = await getPerfil();
    numCelular = perfil.contacto?.nroCelular ?? "";
    email = perfil.contacto?.email ?? "";
    s3.stop("Datos obtenidos.");
  } catch {
    s3.stop("No se pudo obtener el perfil; continuando sin datos de contacto.");
  }

  // --- Paso 7: generarCita ---
  const s4 = p.spinner();
  s4.start("Reservando cita...");
  try {
    const result = await generarCita({
      codProgAsis: elegido.cupo.codProgAsis,
      consultorio: elegido.cupo.consultorio,
      fechaCitaPro: elegido.cupo.fechaCitaProg,
      nroCupo: elegido.slot.nroCupo,
      turnoIni: elegido.cupo.turnoIni,
      turnoFin: elegido.cupo.turnoFin,
      numCelular,
      email,
    });
    s4.stop("Cita reservada.");
    const cita = result[0];
    if (cita) {
      p.note(
        [
          `N° de cita  : ${cita.numCitaCreada ?? "—"}`,
          `Fecha       : ${cita.fechaCita ?? elegido.cupo.fechaCitaProg}`,
          `Hora        : ${cita.horaCita ?? elegido.slot.hora}`,
          `Profesional : ${cita.apeNomProf ?? elegido.cupo.apeNomProf}`,
          `Especialidad: ${cita.desServHosp ?? servicioElegido.desServicioHosp}`,
        ].join("\n"),
        "Cita confirmada",
      );
    }
  } catch (err) {
    s4.stop("Error al reservar la cita.");
    p.log.error(String(err));
  }
}

// ---------------------------------------------------------------------------
// Cancelar cita — flujo guiado
// ---------------------------------------------------------------------------

async function runCancelar(ts: TokenStatus): Promise<void> {
  if (!(await requireLogin(ts))) return;

  const s = p.spinner();
  s.start("Cargando citas...");
  let citas: CitaEmitida[] = [];
  try {
    citas = await getCitasEmitidas();
  } catch (err) {
    s.stop("Error al cargar las citas.");
    p.log.error(String(err));
    return;
  }

  // Solo ofrecemos las que la API marca como cancelables (deja fuera las anuladas).
  const cancelables = citas.filter((c) => c.puedeCancelar === true);
  s.stop(`${citas.length} cita(s); ${cancelables.length} cancelable(s).`);

  if (cancelables.length === 0) {
    p.log.info("No hay citas que puedas cancelar (las anuladas no cuentan).");
    return;
  }

  const opts = cancelables.map((c) => {
    const id = c.citActMedNum ?? c.citAutoGenCod ?? "?";
    const fecha = c.citFecha ?? "—";
    const hora = c.citHora ?? "—";
    const centro = c.citCenAsiDes ?? "—";
    return {
      value: id,
      label: `[${id}] ${fecha} ${hora}`,
      hint: centro,
    };
  });

  const citaId = await p.select<string>({
    message: "Elige la cita a cancelar",
    options: opts,
  });
  if (p.isCancel(citaId)) return;

  const confirma = await p.confirm({
    message: `¿Cancelar la cita ${citaId as string}? Esta acción es irreversible.`,
    initialValue: false,
  });
  if (p.isCancel(confirma) || !confirma) {
    p.log.info("Cancelación abortada.");
    return;
  }

  // Necesitamos el centro de la cita para cancelarla. Si no viene, abortamos:
  // adivinarlo podría cancelar contra el centro equivocado (operación irreversible).
  const citaObj = citas.find((c) => c.citActMedNum === citaId || c.citAutoGenCod === citaId);
  const codCentro = citaObj?.citCenAsiCod;
  if (!codCentro) {
    p.log.error(
      "No pude determinar el centro de esa cita; no la cancelo para no afectar la equivocada.",
    );
    return;
  }

  const s2 = p.spinner();
  s2.start("Cancelando cita...");
  try {
    await request("POST", "eliminarCita", {
      oriCenAsis: "1",
      numCitaCreada: citaId as string,
      codCentro,
    });
    s2.stop("Cita cancelada correctamente.");
    p.log.success(`Cita ${citaId as string} cancelada.`);
  } catch (err) {
    s2.stop("Error al cancelar la cita.");
    p.log.error(String(err));
  }
}

// ---------------------------------------------------------------------------
// Menú principal — loop hasta Salir
// ---------------------------------------------------------------------------

type MenuOption = "login" | "perfil" | "citas" | "reservar" | "cancelar" | "salir";

export async function runInteractiveMode(): Promise<void> {
  const ts = await getTokenStatus();
  await printBanner(ts);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Re-fetch ts inside loop for menu state updates after login
    const loopTs = await getTokenStatus();

    const opcion = await p.select<MenuOption>({
      message: "¿Qué quieres hacer?",
      options: [
        { value: "login", label: "Login", hint: "Iniciar sesión en EsSalud" },
        { value: "perfil", label: "Mi perfil", hint: "Ver datos del asegurado" },
        { value: "citas", label: "Mis citas", hint: "Ver citas programadas" },
        {
          value: "reservar",
          label: "Reservar una cita",
          hint: "Flujo guiado: especialidad → cupo → confirmar",
        },
        { value: "cancelar", label: "Cancelar una cita", hint: "Seleccionar y cancelar una cita" },
        { value: "salir", label: "Salir", hint: "Cerrar el asistente" },
      ],
    });

    if (p.isCancel(opcion) || opcion === "salir") {
      p.outro("Hasta luego.");
      process.exit(0);
    }

    switch (opcion) {
      case "login":
        await runLogin();
        break;
      case "perfil":
        await runPerfil(loopTs);
        break;
      case "citas":
        await runCitas(loopTs);
        break;
      case "reservar":
        await runReservar(loopTs);
        break;
      case "cancelar":
        await runCancelar(loopTs);
        break;
    }
  }
}
