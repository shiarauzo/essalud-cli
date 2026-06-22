import { type CitaEmitida, getCitasEmitidas } from "./api.js";

function formatCita(c: CitaEmitida, idx: number): void {
  console.log(`\nCita #${idx + 1}`);
  const campos: Array<[string, string]> = [
    ["Fecha", c.citFecha ?? ""],
    ["Hora", c.citHora ?? ""],
    ["Centro", c.citCenAsiDes ?? ""],
    ["Estado", c.citEstCita ?? ""],
    ["Nro cita", c.citActMedNum ?? ""],
    ["Cod autogen", c.citAutoGenCod ?? ""],
  ];
  for (const [label, val] of campos) {
    if (val) console.log(`  ${label.padEnd(12)}: ${val}`);
  }
  // Campos extras que lleguen del API
  const conocidos = new Set([
    "citFecha",
    "citHora",
    "citCenAsiDes",
    "citEstCita",
    "citActMedNum",
    "citAutoGenCod",
  ]);
  for (const [k, v] of Object.entries(c)) {
    if (!conocidos.has(k) && v !== null && v !== undefined && v !== "") {
      console.log(`  ${k.padEnd(12)}: ${String(v)}`);
    }
  }
}

export async function cmdCitas(): Promise<void> {
  let citas: CitaEmitida[];
  try {
    citas = await getCitasEmitidas();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  if (citas.length === 0) {
    console.log("No tienes citas registradas.");
    return;
  }

  console.log(`Citas emitidas (${citas.length})`);
  console.log("─".repeat(40));
  citas.forEach(formatCita);
}
