import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const BASE_URL = "https://api.miconsulta.essalud.gob.pe/api";

export const TOKEN_PATH = join(homedir(), ".tramites-pe", "essalud", "token");
export const PACIENTE_PATH = join(homedir(), ".tramites-pe", "essalud", "paciente.json");

export interface PacienteData {
  codCentro: string;
  desCentro: string;
  apePaterno: string;
  apeMaterno: string;
  nombres: string | null;
  email: string | null;
  celular: string | null;
}

/** Lee ~/.tramites-pe/essalud/paciente.json. Devuelve null si no existe. */
export async function getPaciente(): Promise<PacienteData | null> {
  try {
    const raw = await readFile(PACIENTE_PATH, "utf-8");
    return JSON.parse(raw) as PacienteData;
  } catch {
    return null;
  }
}

/** Lee el token raw desde ~/.tramites-pe/essalud/token */
export async function readToken(): Promise<string> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return raw.trim();
  } catch {
    throw new Error(
      `No hay token guardado. Guarda tu Bearer token en ${TOKEN_PATH} (chmod 600).`
    );
  }
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
export async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const token = await readToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await fetch(`${BASE_URL}/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${method} /${path}`);
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
    public readonly desError: string
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
export async function getProgramacionDisponible(
  payload: ProgramacionPayload
): Promise<Cupo[]> {
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
