import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const BASE_URL = "https://api.miconsulta.essalud.gob.pe/api";

export const TOKEN_PATH = join(homedir(), ".essalud", "token");
export const REFRESH_TOKEN_PATH = join(homedir(), ".essalud", "refresh_token");
export const PACIENTE_PATH = join(homedir(), ".essalud", "paciente.json");

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly method: "GET" | "POST",
    public readonly path: string,
  ) {
    super(`HTTP ${status} ${statusText} — ${method} ${path}`);
    this.name = "HttpError";
  }
}

/** Ubicación antigua del token (antes de renombrar el proyecto a essalud-cli).
 *  Solo se usa para dar un mensaje de diagnóstico; no se lee como token válido. */
const LEGACY_TOKEN_PATH = join(homedir(), ".tramites-pe", "essalud", "token");

export interface PacienteData {
  codCentro: string;
  desCentro: string;
  apePaterno: string;
  apeMaterno: string;
  nombres: string | null;
  email: string | null;
  celular: string | null;
}

/** Lee ~/.essalud/paciente.json. Devuelve null si no existe. */
export async function getPaciente(): Promise<PacienteData | null> {
  try {
    const raw = await readFile(PACIENTE_PATH, "utf-8");
    return JSON.parse(raw) as PacienteData;
  } catch {
    return null;
  }
}

/** Lee el token raw desde ~/.essalud/token */
export async function readToken(): Promise<string> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return raw.trim();
  } catch {
    // Diagnóstico: si hay un token en la ubicación antigua, explica el cambio.
    let migracion = "";
    try {
      await readFile(LEGACY_TOKEN_PATH, "utf-8");
      migracion =
        ` Tu sesión estaba en una ubicación antigua (${LEGACY_TOKEN_PATH}) que ya no se usa;` +
        ` ahora el token vive en ${TOKEN_PATH}.`;
    } catch {
      // No había token viejo: mensaje genérico.
    }
    throw new Error(
      `No hay sesión activa. Corre \`essalud login\` para iniciar sesión.${migracion}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sesión: credenciales y renovación sin navegador
// ---------------------------------------------------------------------------

/** Par de tokens que devuelven POST /lg (dentro de data.credenciales) y POST /retoken. */
export interface Credenciales {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  jti?: string;
}

/** Lee ~/.essalud/refresh_token. Devuelve null si no existe (sesión sin refresh). */
export async function readRefreshToken(): Promise<string | null> {
  try {
    const raw = await readFile(REFRESH_TOKEN_PATH, "utf-8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** Escribe un archivo de sesión con permisos 600 (writeFile puede quedar enmascarado
 *  por el umask, así que forzamos el modo después). */
async function writeSecret(path: string, contenido: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${contenido}\n`, { encoding: "utf-8", mode: 0o600 });
  await chmod(path, 0o600);
}

/** Guarda el access token y su refresh token.
 *  Si las credenciales nuevas no traen refresh, borra el guardado: pertenecía a la
 *  sesión anterior y renovar con él nos devolvería a esa sesión. */
export async function saveCredenciales(cred: Credenciales): Promise<void> {
  await writeSecret(TOKEN_PATH, cred.access_token);
  if (cred.refresh_token) {
    await writeSecret(REFRESH_TOKEN_PATH, cred.refresh_token);
  } else {
    await rm(REFRESH_TOKEN_PATH, { force: true });
  }
}

/** Saca las credenciales de una respuesta de /lg ({data:{credenciales}}) o de
 *  /retoken (el par va en la raíz). Devuelve null si no hay access_token. */
export function parseCredenciales(json: unknown): Credenciales | null {
  if (typeof json !== "object" || json === null) return null;
  const raiz = json as Record<string, unknown>;
  const data = raiz.data as Record<string, unknown> | undefined;
  const candidato = (
    typeof raiz.access_token === "string" ? raiz : (data?.credenciales ?? null)
  ) as Credenciales | null;
  return candidato && typeof candidato.access_token === "string" ? candidato : null;
}

/**
 * Renueva la sesión con POST /retoken usando el refresh token guardado.
 * EsSalud rota el par en cada llamada (access y refresh vencen juntos, 24h), así
 * que renovar seguido mantiene la sesión viva sin navegador ni captcha.
 * Devuelve el access token nuevo, o null si el refresh fue rechazado.
 * Los errores transitorios se propagan para que el llamador pueda reintentar.
 */
export async function renovarSesion(): Promise<string | null> {
  const refresh = await readRefreshToken();
  if (!refresh) return null;

  // Sin Authorization a propósito: /retoken es público y solo valida el refresh
  // token del body. Mandar el access token vencido hace que el filtro de
  // seguridad responda 403 antes de llegar al handler.
  const res = await fetch(`${BASE_URL}/retoken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) {
      throw new HttpError(res.status, res.statusText, "POST", "/retoken");
    }
    return null;
  }
  const cred = parseCredenciales(await res.json());
  if (!cred) return null;
  await saveCredenciales(cred);
  return cred.access_token;
}

/** Envoltorio estándar de respuestas de EsSalud.
 *  codError "0" = OK; cualquier otro valor es error con mensaje en desError. */
export interface EsSaludResponse<T> {
  codError: string;
  desError: string;
  vDataItem: T;
}

/** Hace una request autenticada.
 *  - Si la respuesta tiene envoltorio {codError, desError, vDataItem}: lo desenvuelve.
 *    codError "0" = OK; otro valor lanza error con desError.
 *  - Si la respuesta NO tiene envoltorio (p.ej. /perfil): devuelve el JSON directo. */
export async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = await readToken();

  const llamar = (jwt: string): Promise<Response> =>
    fetch(`${BASE_URL}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await llamar(token);

  // Token vencido: EsSalud responde 403 (no 401). Renovamos con el refresh token
  // y reintentamos una sola vez antes de mandar al usuario a `essalud login`.
  if (res.status === 401 || res.status === 403) {
    const renovado = await renovarSesion();
    if (renovado) res = await llamar(renovado);
  }

  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, method, `/${path}`);
  }

  const json = (await res.json()) as Record<string, unknown>;

  // Detectar envoltorio: el objeto tiene exactamente las claves del envoltorio
  if ("codError" in json && "desError" in json && "vDataItem" in json) {
    const wrapped = json as unknown as EsSaludResponse<T>;
    if (wrapped.codError !== "0") {
      throw new EsSaludApiError(wrapped.codError, wrapped.desError);
    }
    return wrapped.vDataItem;
  }

  // Sin envoltorio: devolver el JSON directo
  return json as unknown as T;
}

/** Error específico de la API de EsSalud — incluye codError para casos manejables. */
export class EsSaludApiError extends Error {
  constructor(
    public readonly codError: string,
    public readonly desError: string,
  ) {
    super(`EsSalud [${codError}]: ${desError}`);
    this.name = "EsSaludApiError";
  }
}

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

export interface PerfilContacto {
  idContacto?: number;
  nroTelefonoFijo?: string | null;
  nroCelular?: string | null;
  email?: string | null;
  [key: string]: unknown;
}

export interface Perfil {
  idPersona?: number;
  tipoDocIdent?: string;
  numeroDocIdent?: string;
  fechaNacimiento?: string;
  indPadomi?: boolean;
  indApplyPadomi?: boolean;
  contacto?: PerfilContacto | null;
  nombreAsegurado?: string;
  apellidoPatAsegurado?: string;
  apellidoMatAsegurado?: string;
  [key: string]: unknown;
}

export interface CitaEmitida {
  citActMedNum?: string;
  citAutoGenCod?: string;
  citEstCita?: string;
  citFecha?: string;
  citHora?: string;
  citCenAsiDes?: string;
  /** Código del centro de la cita; necesario para cancelarla (POST eliminarCita). */
  citCenAsiCod?: string;
  /** La API marca con `puedeCancelar` si la cita todavía se puede cancelar. */
  puedeCancelar?: boolean;
  /** true si la cita ya fue anulada. */
  citaAnulada?: boolean;
  [key: string]: unknown;
}

export interface ActSubAct {
  codActSubAct: string;
  desActHosp?: string;
  desSubActHosp: string;
}

export interface ServicioHosp {
  codServicioHosp: string;
  desServicioHosp: string;
  vdataActSubAct: ActSubAct[];
}

export interface DataParmSolicitud {
  dataParmServicioHosp: ServicioHosp[];
  [key: string]: unknown;
}

export interface CupoSlot {
  hora: string;
  nroCupo: number;
}

export interface Cupo {
  apeNomProf: string;
  codProgAsis: string;
  codRel?: string;
  consultorio: string;
  fechaCitaProg: string;
  turnoIni: string;
  turnoFin: string;
  /** Lista de slots individuales con hora y número de cupo */
  vCupoDisp: CupoSlot[];
  codActividad?: string;
  codSubActividad?: string;
  [key: string]: unknown;
}

export interface CitaCreada {
  numCitaCreada?: string;
  fechaCita?: string;
  horaCita?: string;
  apeNomProf?: string;
  desServHosp?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /perfil — datos del asegurado */
export async function getPerfil(): Promise<Perfil> {
  return request<Perfil>("GET", "perfil");
}

/** POST /citasEmitidas — citas del usuario.
 *  Devuelve [] si la API responde "no se encontro cita" (codError "1"). */
export async function getCitasEmitidas(): Promise<CitaEmitida[]> {
  try {
    const result = await request<CitaEmitida[] | null>("POST", "citasEmitidas", {});
    return result ?? [];
  } catch (err) {
    if (err instanceof EsSaludApiError && err.codError === "1") {
      return [];
    }
    throw err;
  }
}

/** POST /parametroSolicitud — especialidades disponibles para un centro.
 *  codError "1" = sin datos (devuelve DataParmSolicitud vacío). */
export async function getParametroSolicitud(codCentro: string): Promise<DataParmSolicitud> {
  try {
    const result = await request<DataParmSolicitud>("POST", "parametroSolicitud", { codCentro });
    return result ?? { dataParmServicioHosp: [] };
  } catch (err) {
    if (err instanceof EsSaludApiError && err.codError === "1") {
      return { dataParmServicioHosp: [] };
    }
    throw err;
  }
}

export interface ProgramacionPayload {
  codCentro: string;
  codServicioHosp: string;
  codActSubAct: string;
  codTurnoDeseado: string;
}

/** POST /programacionDisponible — cupos disponibles.
 *  codError "1" = sin programación disponible (no es error, devuelve []). */
export async function getProgramacionDisponible(payload: ProgramacionPayload): Promise<Cupo[]> {
  try {
    const result = await request<Cupo[] | null>("POST", "programacionDisponible", payload);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    if (err instanceof EsSaludApiError && err.codError === "1") {
      return [];
    }
    throw err;
  }
}

export interface GenerarCitaPayload {
  codProgAsis: string;
  consultorio: string;
  fechaCitaPro: string;
  /** Número de cupo individual (viene de vCupoDisp[].nroCupo) */
  nroCupo: number;
  turnoIni: string;
  turnoFin: string;
  numCelular: string;
  email: string;
}

/** POST /generarCita — reserva una cita REAL.
 *  ADVERTENCIA: ocupa un cupo real. Solo llamar con confirmación explícita del usuario. */
export async function generarCita(payload: GenerarCitaPayload): Promise<CitaCreada[]> {
  return request<CitaCreada[]>("POST", "generarCita", payload);
}
