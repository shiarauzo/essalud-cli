import { createInterface } from "node:readline";
import { getPerfil, generarCita, type Cupo, type GenerarCitaPayload } from "./api.js";

export interface ReservarOptions {
  cupoJson?: string;
  nroCupo?: string;
  horaSlot?: string;
  // Flags alternativos (si no se usa --cupo-json)
  codProgAsis?: string;
  consultorio?: string;
  fecha?: string;
  turnoIni?: string;
  turnoFin?: string;
  celular?: string;
  email?: string;
  confirm: boolean;
}

async function confirmarInteractivo(mensaje: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${mensaje} [s/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "s");
    });
  });
}

export async function cmdReservar(opts: ReservarOptions): Promise<void> {
  // Resolver el cupo desde --cupo-json o desde flags individuales
  let cupoData: Partial<Cupo> = {};

  if (opts.cupoJson) {
    try {
      cupoData = JSON.parse(opts.cupoJson) as Partial<Cupo>;
    } catch {
      console.error("Error: --cupo-json no es JSON válido.");
      process.exit(1);
    }
  } else {
    if (opts.codProgAsis) cupoData.codProgAsis = opts.codProgAsis;
    if (opts.consultorio) cupoData.consultorio = opts.consultorio;
    if (opts.fecha) cupoData.fechaCitaProg = opts.fecha;
    if (opts.turnoIni) cupoData.turnoIni = opts.turnoIni;
    if (opts.turnoFin) cupoData.turnoFin = opts.turnoFin;
  }

  // --nro-cupo es obligatorio (elige el slot de vCupoDisp)
  if (!opts.nroCupo) {
    console.error("Error: falta --nro-cupo (elige un slot de la salida de 'fechas').");
    process.exit(1);
  }
  const nroCupo = Number(opts.nroCupo);
  if (Number.isNaN(nroCupo)) {
    console.error(`Error: --nro-cupo debe ser un número, recibí "${opts.nroCupo}".`);
    process.exit(1);
  }

  // Validar campos obligatorios del cupo
  const requiredFields = [
    "codProgAsis",
    "consultorio",
    "fechaCitaProg",
    "turnoIni",
    "turnoFin",
  ] as const;

  for (const field of requiredFields) {
    if (!cupoData[field]) {
      console.error(
        `Error: falta el campo "${field}". Usá --cupo-json '<json>' o los flags individuales.`
      );
      process.exit(1);
    }
  }

  // Resolver numCelular y email: flags > perfil
  let numCelular = opts.celular ?? "";
  let email = opts.email ?? "";

  if (!numCelular || !email) {
    let perfil: Awaited<ReturnType<typeof getPerfil>>;
    try {
      perfil = await getPerfil();
    } catch (err) {
      console.error(`Error al obtener perfil: ${String(err)}`);
      process.exit(1);
    }
    if (!numCelular) numCelular = perfil.contacto?.nroCelular ?? "";
    if (!email) email = perfil.contacto?.email ?? "";
  }

  if (!numCelular || !email) {
    console.error(
      "Error: no se encontró celular/email en el perfil. Pasalos con --celular y --email."
    );
    process.exit(1);
  }

  // Encontrar la hora del slot si se pasó --hora-slot (para mostrar)
  let horaDisplay = opts.horaSlot ?? "(no especificada)";
  if (!opts.horaSlot && cupoData.vCupoDisp) {
    const slot = cupoData.vCupoDisp.find((s) => s.nroCupo === nroCupo);
    if (slot) horaDisplay = slot.hora;
  }

  // Construir el payload final
  const payload: GenerarCitaPayload = {
    codProgAsis: cupoData.codProgAsis as string,
    consultorio: cupoData.consultorio as string,
    fechaCitaPro: cupoData.fechaCitaProg as string,
    nroCupo,
    turnoIni: cupoData.turnoIni as string,
    turnoFin: cupoData.turnoFin as string,
    numCelular,
    email,
  };

  // Mostrar resumen
  console.log("Resumen de la cita a reservar:");
  console.log("─".repeat(50));
  if (cupoData.apeNomProf) console.log(`  Profesional    : ${cupoData.apeNomProf}`);
  console.log(`  Fecha          : ${payload.fechaCitaPro}`);
  console.log(`  Hora del slot  : ${horaDisplay}`);
  console.log(`  Cupo nro       : ${payload.nroCupo}`);
  console.log(`  Turno          : ${payload.turnoIni} - ${payload.turnoFin}`);
  console.log(`  Consultorio    : ${payload.consultorio}`);
  console.log(`  codProgAsis    : ${payload.codProgAsis}`);
  console.log(`  Celular        : ${payload.numCelular}`);
  console.log(`  Email          : ${payload.email}`);
  console.log("");

  // DRY-RUN por defecto
  if (!opts.confirm) {
    console.log("[dry-run] No se realizó ninguna reserva real.");
    console.log("Para reservar de verdad: agrega --confirm al comando.");
    return;
  }

  // Confirmación interactiva obligatoria
  const ok = await confirmarInteractivo(
    "ADVERTENCIA: Esto agenda una cita REAL en EsSalud. ¿Confirmás? (ocupa un cupo)"
  );

  if (!ok) {
    console.log("Cancelado. No se realizó ninguna reserva.");
    return;
  }

  // POST generarCita
  let result: Awaited<ReturnType<typeof generarCita>>;
  try {
    result = await generarCita(payload);
  } catch (err) {
    console.error(`Error al generar la cita: ${String(err)}`);
    process.exit(1);
  }

  const cita = result[0];
  console.log("\nCita reservada exitosamente.");
  console.log("─".repeat(50));
  if (cita?.numCitaCreada) console.log(`  Nro cita   : ${cita.numCitaCreada}`);
  if (cita?.fechaCita) console.log(`  Fecha      : ${cita.fechaCita}`);
  if (cita?.horaCita) console.log(`  Hora       : ${cita.horaCita}`);
  if (cita?.apeNomProf) console.log(`  Profesional: ${cita.apeNomProf}`);
  if (cita?.desServHosp) console.log(`  Servicio   : ${cita.desServHosp}`);
}
