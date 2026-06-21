import { getProgramacionDisponible, type Cupo } from "./api.js";

function formatCupo(c: Cupo, idx: number): void {
  console.log(`\n  [${idx + 1}] ${c.apeNomProf}`);
  console.log(`       Fecha      : ${c.fechaCitaProg}`);
  console.log(`       Turno      : ${c.turnoIni} - ${c.turnoFin}`);
  console.log(`       Consultorio: ${c.consultorio}`);
  console.log(`       codProgAsis: ${c.codProgAsis}`);
  if (c.vCupoDisp && c.vCupoDisp.length > 0) {
    console.log(`       Slots disponibles (${c.vCupoDisp.length}):`);
    for (const slot of c.vCupoDisp) {
      console.log(`         cupo ${String(slot.nroCupo).padStart(3)}  hora ${slot.hora}`);
    }
  } else {
    console.log("       Sin slots disponibles.");
  }
}

export async function cmdFechas(
  codCentro: string,
  codServicioHosp: string,
  codActSubAct: string
): Promise<void> {
  let cupos: Cupo[];
  try {
    cupos = await getProgramacionDisponible({
      codCentro,
      codServicioHosp,
      codActSubAct,
      codTurnoDeseado: "0",
    });
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  if (cupos.length === 0) {
    console.log(
      `Sin programación disponible para centro=${codCentro} servicio=${codServicioHosp} actividad=${codActSubAct}.`
    );
    return;
  }

  console.log(
    `Cupos disponibles — centro=${codCentro} servicio=${codServicioHosp} actividad=${codActSubAct} (${cupos.length} turnos)`
  );
  console.log("─".repeat(60));
  cupos.forEach(formatCupo);
  console.log("");
  console.log("Para reservar, elegí un slot y pasá el JSON del cupo:");
  console.log(
    "  essalud reservar --cupo-json '<json>' --nro-cupo <nro> --hora-slot <hora> --confirm"
  );
  console.log("Ejemplo (primer slot del primer turno):");
  if (cupos[0] && cupos[0].vCupoDisp[0]) {
    const ejemplo = { ...cupos[0] };
    console.log(`  essalud reservar --cupo-json '${JSON.stringify(ejemplo)}' --nro-cupo ${cupos[0].vCupoDisp[0].nroCupo} --hora-slot ${cupos[0].vCupoDisp[0].hora}`);
  }
}
