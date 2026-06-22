// Helpers puros para trabajar con JWTs de EsSalud (sin efectos secundarios).

/** Matchea un JWT (header.payload.signature en base64url). */
export const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

export interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

/** Un JWT de EsSalud decodifica con exp o scope en el payload. */
export function looksLikeEsSaludJwt(jwt: string): boolean {
  try {
    const part = jwt.split(".")[1] ?? "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf-8",
    );
    const payload = JSON.parse(json) as { exp?: number; scope?: unknown };
    return typeof payload.exp === "number" || payload.scope != null;
  } catch {
    return false;
  }
}

/** Decodifica el payload de un JWT (sin verificar la firma). Devuelve null si no es válido. */
export function decodeJwtPayload(jwt: string): JwtPayload | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as JwtPayload;
  } catch {
    return null;
  }
}
