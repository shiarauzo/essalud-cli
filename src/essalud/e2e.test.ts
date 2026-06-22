import { afterAll, describe, expect, it } from "vitest";
import {
  generarCita,
  getCitasEmitidas,
  getPaciente,
  getParametroSolicitud,
  getPerfil,
  getProgramacionDisponible,
  request,
} from "./api.js";

// ---------------------------------------------------------------------------
// Pruebas END-TO-END contra la API REAL de EsSalud.
//
// Solo corren con ESSALUD_E2E=1 y un token válido ya guardado (`essalud login`).
// NUNCA corren en `pnpm test` ni en CI de PRs.
//
// El flujo completo (reservar → cancelar) es AUTO-LIMPIANTE: la reserva se cancela
// SIEMPRE en un `finally`, así nunca queda una cita médica real colgada, aunque
// una aserción falle a la mitad. Se elige el cupo más lejano para minimizar impacto.
// ---------------------------------------------------------------------------

const ENABLED = process.env.ESSALUD_E2E === "1";

describe.skipIf(!ENABLED)("e2e · solo lectura", () => {
  it("getPerfil devuelve el asegurado", async () => {
    const perfil = await getPerfil();
    expect(perfil).toBeTruthy();
  });

  it("getCitasEmitidas devuelve un arreglo", async () => {
    expect(Array.isArray(await getCitasEmitidas())).toBe(true);
  });
});

describe.skipIf(!ENABLED)("e2e · flujo completo reservar→cancelar (auto-limpiante)", () => {
  let numCitaCreada: string | null = null;
  let codCentro = "";

  afterAll(async () => {
    // Red de seguridad: si quedó una cita creada, cancelarla sí o sí.
    if (!numCitaCreada) return;
    try {
      await request("POST", "eliminarCita", {
        oriCenAsis: "1",
        numCitaCreada,
        codCentro,
      });
    } catch (err) {
      // Importante avisar: quedó una cita real sin cancelar.
      console.error(`[e2e] NO se pudo cancelar la cita ${numCitaCreada}: ${String(err)}`);
    }
  });

  it("reserva el cupo más lejano y lo cancela", async () => {
    const paciente = await getPaciente();
    codCentro = paciente?.codCentro ?? "";
    expect(codCentro, "se necesita paciente.json con codCentro").not.toBe("");

    const { dataParmServicioHosp = [] } = await getParametroSolicitud(codCentro);
    const servicio = dataParmServicioHosp[0];
    const actividad = servicio?.vdataActSubAct?.[0];
    expect(actividad, "el centro debe tener al menos una especialidad/actividad").toBeTruthy();
    if (!servicio || !actividad) return;

    const cupos = await getProgramacionDisponible({
      codCentro,
      codServicioHosp: servicio.codServicioHosp,
      codActSubAct: actividad.codActSubAct,
      codTurnoDeseado: "0",
    });
    if (cupos.length === 0) {
      console.warn("[e2e] sin cupos disponibles; no se puede probar el flujo de reserva.");
      return;
    }

    // El cupo más lejano (último de la lista cronológica) y su último slot.
    const cupo = cupos[cupos.length - 1];
    const slot = cupo.vCupoDisp[cupo.vCupoDisp.length - 1];
    const perfil = await getPerfil();

    const creada = await generarCita({
      codProgAsis: cupo.codProgAsis,
      consultorio: cupo.consultorio,
      fechaCitaPro: cupo.fechaCitaProg,
      nroCupo: slot.nroCupo,
      turnoIni: cupo.turnoIni,
      turnoFin: cupo.turnoFin,
      numCelular: perfil.contacto?.nroCelular ?? "",
      email: perfil.contacto?.email ?? "",
    });

    numCitaCreada = creada[0]?.numCitaCreada ?? null;
    expect(numCitaCreada, "la reserva debe devolver numCitaCreada").toBeTruthy();
  });
});
