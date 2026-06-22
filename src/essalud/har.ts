// Helpers puros para extraer el token y los datos del paciente de un HAR
// exportado de DevTools, o del body de la respuesta /api/lg del login.

import type { PacienteData } from "./api.js";
import { JWT_RE, looksLikeEsSaludJwt } from "./jwt.js";

interface HarEntry {
  request: {
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { text?: string };
  };
  response?: {
    content?: { text?: string };
  };
  startedDateTime?: string;
}

interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

/** Extrae los datos del paciente del body JSON de la respuesta /api/lg. */
export function parsePacienteFromLgBody(responseText: string): PacienteData | null {
  if (!responseText) return null;
  try {
    const json = JSON.parse(responseText) as {
      data?: {
        paciente?: {
          codCentro?: string;
          desCentro?: string;
          apePaterno?: string;
          apeMaterno?: string;
          nombres?: string;
          email?: string;
          nroCelular?: string;
          celular?: string;
        };
      };
    };

    const raw = json?.data?.paciente;
    if (!raw) return null;

    return {
      codCentro: raw.codCentro ?? "",
      desCentro: raw.desCentro ?? "",
      apePaterno: raw.apePaterno ?? "",
      apeMaterno: raw.apeMaterno ?? "",
      nombres: raw.nombres ?? null,
      email: raw.email ?? null,
      celular: raw.nroCelular ?? raw.celular ?? null,
    };
  } catch {
    return null;
  }
}

/** Extrae el JWT Bearer más reciente de un HAR. */
export function extractTokenFromHar(harPath: string, harContent: string): string | null {
  let har: HarFile;
  try {
    har = JSON.parse(harContent) as HarFile;
  } catch {
    throw new Error(`HAR inválido (no es JSON válido): ${harPath}`);
  }

  const entries = har.log?.entries ?? [];
  const candidates: string[] = [];

  for (const entry of entries) {
    const req = entry.request;
    const resp = entry.response;

    // 1) Header Authorization: Bearer <jwt> (cuando el HAR lo conserva).
    const authHeader = req?.headers?.find((h) => h.name.toLowerCase() === "authorization");
    const authMatch = authHeader?.value.match(/Bearer\s+(\S+)/i);
    if (authMatch && looksLikeEsSaludJwt(authMatch[1])) candidates.push(authMatch[1]);

    // 2) JWT embebido en el body (el login /api/lg devuelve el token ahí; Chrome
    //    NO exporta el header Authorization al HAR, pero sí el body).
    for (const blob of [resp?.content?.text ?? "", req?.postData?.text ?? ""]) {
      const m = blob.match(JWT_RE);
      if (m && looksLikeEsSaludJwt(m[0])) candidates.push(m[0]);
    }
  }

  if (candidates.length === 0) return null;
  // El más reciente (los HAR son cronológicos).
  return candidates[candidates.length - 1];
}

/** Busca la entry /api/lg en el HAR y extrae datos del paciente. */
export function extractPacienteFromHar(harContent: string): PacienteData | null {
  let har: { log?: { entries?: HarEntry[] } };
  try {
    har = JSON.parse(harContent) as { log?: { entries?: HarEntry[] } };
  } catch {
    return null;
  }

  for (const entry of har.log?.entries ?? []) {
    if (!(entry.request?.url ?? "").includes("/api/lg")) continue;
    const paciente = parsePacienteFromLgBody(entry.response?.content?.text ?? "");
    if (paciente) return paciente;
  }

  return null;
}
