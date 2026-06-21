import { readToken, TOKEN_PATH } from "./api.js";

/** Decodifica el payload de un JWT sin verificar la firma. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // Node 18+ tiene atob o Buffer
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function cmdToken(): Promise<void> {
  let token: string;
  try {
    token = await readToken();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const payload = decodeJwtPayload(token);

  if (!payload) {
    console.log("Token guardado pero no es un JWT válido (no se puede decodificar).");
    return;
  }

  const exp = typeof payload["exp"] === "number" ? payload["exp"] : null;
  const iat = typeof payload["iat"] === "number" ? payload["iat"] : null;
  // El JWT de EsSalud usa user_name (no sub) y scope es un array
  const userName =
    typeof payload["user_name"] === "string"
      ? payload["user_name"]
      : typeof payload["sub"] === "string"
      ? payload["sub"]
      : null;
  const scope = Array.isArray(payload["scope"])
    ? (payload["scope"] as string[]).join(", ")
    : typeof payload["scope"] === "string"
    ? payload["scope"]
    : null;
  const clientId =
    typeof payload["client_id"] === "string" ? payload["client_id"] : null;

  const now = Math.floor(Date.now() / 1000);
  const expired = exp !== null ? now > exp : null;

  console.log("Token EsSalud");
  console.log("─".repeat(40));
  console.log(`Archivo   : ${TOKEN_PATH}`);
  if (userName) console.log(`Usuario   : ${userName}`);
  if (clientId) console.log(`Cliente   : ${clientId}`);
  if (scope) console.log(`Scope     : ${scope}`);
  if (iat) console.log(`Emitido   : ${new Date(iat * 1000).toLocaleString("es-PE")}`);
  if (exp) {
    const expiresAt = new Date(exp * 1000).toLocaleString("es-PE");
    const secsLeft = exp - now;
    if (expired) {
      console.log(`Vence     : ${expiresAt}  (VENCIDO hace ${Math.abs(secsLeft)}s)`);
      console.log("\nEl token esta vencido. Necesitas obtener uno nuevo.");
    } else {
      const minsLeft = Math.floor(secsLeft / 60);
      const hoursLeft = Math.floor(minsLeft / 60);
      const display =
        hoursLeft > 0 ? `${hoursLeft}h ${minsLeft % 60}min` : `${minsLeft} min`;
      console.log(`Vence     : ${expiresAt}  (en ${display})`);
      console.log("\nToken vigente.");
    }
  } else {
    console.log("Vence     : (sin campo exp)");
  }
}
