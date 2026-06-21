import { getParametroSolicitud, type ServicioHosp } from "./api.js";

function formatServicio(s: ServicioHosp): void {
  console.log(`\n  [${s.codServicioHosp}] ${s.desServicioHosp}`);
  if (s.vdataActSubAct && s.vdataActSubAct.length > 0) {
    for (const a of s.vdataActSubAct) {
      console.log(`        ${a.codActSubAct.padEnd(8)} ${a.desSubActHosp}`);
    }
  }
}

export async function cmdEspecialidades(codCentro: string): Promise<void> {
  let data: Awaited<ReturnType<typeof getParametroSolicitud>>;
  try {
    data = await getParametroSolicitud(codCentro);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const servicios = data.dataParmServicioHosp;

  if (!servicios || servicios.length === 0) {
    console.log(`Sin especialidades para el centro "${codCentro}".`);
    return;
  }

  console.log(`Especialidades — centro ${codCentro} (${servicios.length})`);
  console.log("─".repeat(50));
  for (const s of servicios) {
    formatServicio(s);
  }
  console.log("");
}
