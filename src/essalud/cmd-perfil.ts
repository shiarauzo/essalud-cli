import { getPerfil, getPaciente, type Perfil } from "./api.js";

function printField(label: string, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  if (typeof value === "object") {
    // Expandir objetos anidados (p.ej. contacto)
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      printField(`${label}.${k}`, v);
    }
  } else {
    console.log(`${label.padEnd(20)} : ${String(value)}`);
  }
}

export async function cmdPerfil(): Promise<void> {
  let perfil: Perfil;
  try {
    perfil = await getPerfil();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const paciente = await getPaciente();

  console.log("Perfil EsSalud");
  console.log("─".repeat(40));

  // Datos enriquecidos desde paciente.json (que /perfil no trae)
  if (paciente) {
    const nombre = [paciente.apePaterno, paciente.apeMaterno, paciente.nombres]
      .filter(Boolean)
      .join(" ");
    console.log(`${"Nombre".padEnd(20)} : ${nombre}`);
    console.log(`${"Centro".padEnd(20)} : ${paciente.desCentro}`);
  }

  for (const [k, v] of Object.entries(perfil)) {
    printField(k, v);
  }
}
