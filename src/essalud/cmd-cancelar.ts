import { createInterface } from "node:readline";
import { type CitaEmitida, EsSaludApiError, getCitasEmitidas, request } from "./api.js";

// Endpoint de cancelación CONFIRMADO del HAR (2026-06-20):
//   POST /eliminarCita  { oriCenAsis: "1", numCitaCreada, codCentro }
//   -> codError "0" = cancelada.
// numCitaCreada = citActMedNum (de citasEmitidas); codCentro = citCenAsiCod.

export interface CancelarOptions {
  confirm: boolean;
  codCentro?: string;
}

function confirmarInteractivo(mensaje: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${mensaje} [s/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "s");
    });
  });
}

// Busca la cita en citasEmitidas para obtener su codCentro (citCenAsiCod).
async function buscarCita(citActMedNum: string): Promise<CitaEmitida | undefined> {
  try {
    const citas = await getCitasEmitidas();
    return citas.find((c) => c.citActMedNum === citActMedNum);
  } catch {
    // sin citas o error de lectura -> caemos al fallback de --cod-centro
  }
  return undefined;
}

export async function cmdCancelar(citActMedNum: string, opts: CancelarOptions): Promise<void> {
  console.log(`Cancelar cita: ${citActMedNum}`);
  console.log("─".repeat(50));

  const cita = await buscarCita(citActMedNum);
  const codCentro = opts.codCentro ?? cita?.citCenAsiCod;

  if (!codCentro) {
    console.error(
      "No encontré la cita ni su centro. Pasa el centro con --cod-centro <cod> (es el citCenAsiCod de la cita en `essalud citas`).",
    );
    process.exit(1);
  }

  // Si la encontramos y la API dice que no se puede cancelar (p. ej. ya anulada), paramos.
  // Nota: acá bloqueamos solo el caso DEFINITIVO (`=== false`) porque el usuario nombró
  // una cita explícita; el menú interactivo, en cambio, solo OFRECE las `=== true`
  // (más conservador, para no listar candidatas dudosas en una operación irreversible).
  if (cita && cita.puedeCancelar === false) {
    const motivo = cita.citaAnulada ? "ya está anulada" : "no se puede cancelar";
    console.error(
      `Esta cita ${motivo} (estado: ${cita.citEstCita ?? "?"}). No hay nada que cancelar.`,
    );
    process.exit(1);
  }

  if (cita) {
    console.log(
      `${cita.citEstCita ?? ""}  ${cita.citFecha ?? ""} ${cita.citHora ?? ""}  ·  ${cita.citCenAsiDes ?? codCentro}`.trim(),
    );
  }
  console.log(
    `Endpoint: POST /eliminarCita { oriCenAsis:"1", numCitaCreada:"${citActMedNum}", codCentro:"${codCentro}" }`,
  );
  console.log("");

  if (!opts.confirm) {
    console.log("[dry-run] No se canceló nada.");
    console.log("Para cancelar de verdad: agrega --confirm al comando.");
    return;
  }

  const ok = await confirmarInteractivo(
    `Esto CANCELA la cita ${citActMedNum} de verdad. ¿Confirmas?`,
  );
  if (!ok) {
    console.log("Cancelado. No se realizó ninguna operación.");
    return;
  }

  try {
    const result = await request<unknown>("POST", "eliminarCita", {
      oriCenAsis: "1",
      numCitaCreada: citActMedNum,
      codCentro,
    });
    console.log("\n✓ Cita cancelada.");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof EsSaludApiError) {
      console.error(`Error de API [${err.codError}]: ${err.desError}`);
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }
}
