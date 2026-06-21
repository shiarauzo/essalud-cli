import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser } from "playwright";
import { TOKEN_PATH, PACIENTE_PATH, getPerfil, type Perfil, type PacienteData } from "./api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOGIN_URL = "https://miconsulta.essalud.gob.pe/login";
const API_HOST = "api.miconsulta.essalud.gob.pe";
/** Tiempo máximo que esperamos a que el usuario complete el login en el navegador. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LoginOptions {
  /** JWT to save directly (skip browser) */
  token?: string;
  /** Path to a HAR file to extract the token from */
  fromHar?: string;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** Matchea un JWT (header.payload.signature en base64url). */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

/** Un JWT de EsSalud decodifica con exp o scope en el payload. */
function looksLikeEsSaludJwt(jwt: string): boolean {
  try {
    const part = jwt.split(".")[1] ?? "";
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    const payload = JSON.parse(json) as { exp?: number; scope?: unknown };
    return typeof payload.exp === "number" || payload.scope != null;
  } catch {
    return false;
  }
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
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

// ---------------------------------------------------------------------------
// Paciente parsing (compartido entre login por navegador y por HAR)
// ---------------------------------------------------------------------------

/** Extrae los datos del paciente del body JSON de la respuesta /api/lg. */
function parsePacienteFromLgBody(responseText: string): PacienteData | null {
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

// ---------------------------------------------------------------------------
// HAR parsing (para `--from-har`)
// ---------------------------------------------------------------------------

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
function extractPacienteFromHar(harContent: string): PacienteData | null {
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

// ---------------------------------------------------------------------------
// Login por navegador (Playwright)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Abre un navegador real (headed), espera a que el usuario se loguee y captura
 * el Bearer token y los datos del paciente directamente de la red.
 * Devuelve null si no se pudo capturar (timeout, navegador cerrado, etc.).
 */
async function loginWithBrowser(): Promise<{ jwt: string; paciente: PacienteData | null } | null> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: false });
  } catch (err) {
    const msg = String(err);
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      console.error("\nFalta el navegador de Playwright. Instalalo una sola vez con:");
      console.error("  npx playwright install chromium\n");
    } else {
      console.error(`\nNo se pudo abrir el navegador: ${msg}\n`);
    }
    return null;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  let jwt: string | null = null;
  let paciente: PacienteData | null = null;

  // Capturar el Bearer de cualquier request autenticado a la API.
  context.on("request", (req) => {
    if (jwt || !req.url().includes(API_HOST)) return;
    const auth = req.headers()["authorization"] ?? "";
    const m = auth.match(/Bearer\s+(\S+)/i);
    if (m && looksLikeEsSaludJwt(m[1])) jwt = m[1];
  });

  // Capturar paciente (y, como respaldo, el token) del body del login /api/lg.
  context.on("response", async (res) => {
    if (!res.url().includes("/api/lg")) return;
    let body: string;
    try {
      body = await res.text();
    } catch {
      return;
    }
    paciente = parsePacienteFromLgBody(body) ?? paciente;
    if (!jwt) {
      const m = body.match(JWT_RE);
      if (m && looksLikeEsSaludJwt(m[0])) jwt = m[0];
    }
  });

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log();
  console.log("─".repeat(60));
  console.log("Se abrió un navegador en:");
  console.log(`  ${LOGIN_URL}`);
  console.log();
  console.log("Pasos:");
  console.log("  1. Ingresa tu DNI y clave.");
  console.log("  2. Completa el captcha de Cloudflare Turnstile.");
  console.log("  3. Espera a ver tu panel (lista de citas).");
  console.log();
  console.log("Voy a capturar tu sesión automáticamente. No cierres esta terminal.");
  console.log("─".repeat(60));

  let browserClosed = false;
  browser.on("disconnected", () => {
    browserClosed = true;
  });

  const start = Date.now();
  while (!jwt && !browserClosed && Date.now() - start < LOGIN_TIMEOUT_MS) {
    await sleep(500);
  }

  await browser.close().catch(() => {});

  if (!jwt) return null;
  return { jwt, paciente };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

async function saveToken(jwt: string): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, jwt + "\n", { encoding: "utf-8", mode: 0o600 });
  // writeFile mode puede quedar enmascarado por el umask — forzamos los permisos.
  await chmod(TOKEN_PATH, 0o600);
}

async function savePaciente(paciente: PacienteData): Promise<void> {
  await mkdir(dirname(PACIENTE_PATH), { recursive: true });
  await writeFile(PACIENTE_PATH, JSON.stringify(paciente, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(PACIENTE_PATH, 0o600);
}

function pacienteLabel(paciente: PacienteData): string {
  const nombre = [paciente.apePaterno, paciente.apeMaterno, paciente.nombres]
    .filter(Boolean)
    .join(" ");
  return `${nombre} · ${paciente.desCentro}`;
}

// ---------------------------------------------------------------------------
// Validación: confirma el token llamando a /perfil
// ---------------------------------------------------------------------------

async function validateAndPrint(jwt: string): Promise<void> {
  let perfil: Perfil;
  try {
    perfil = await getPerfil();
  } catch (err) {
    throw new Error(`Token guardado pero /perfil falló: ${String(err)}`);
  }

  const nombre = [
    perfil.nombreAsegurado,
    perfil.apellidoPatAsegurado,
    perfil.apellidoMatAsegurado,
  ]
    .filter(Boolean)
    .join(" ");

  const payload = decodeJwtPayload(jwt);
  let expInfo = "";
  if (payload?.exp) {
    const expDate = new Date(payload.exp * 1000);
    expInfo = ` | Expira: ${expDate.toLocaleString("es-PE", { timeZone: "America/Lima" })}`;
  }

  console.log(`\n✓ Logueado como: ${nombre || "(sin nombre en perfil)"}${expInfo}`);
}

// ---------------------------------------------------------------------------
// Comando principal
// ---------------------------------------------------------------------------

export async function cmdLogin(opts: LoginOptions = {}): Promise<void> {
  // Plan B — token pegado a mano.
  if (opts.token) {
    const jwt = opts.token.trim().replace(/^Bearer\s+/i, "");
    if (!jwt.startsWith("ey")) {
      console.error("Error: el token no parece un JWT válido (debería empezar con 'ey...').");
      process.exit(1);
    }
    await saveToken(jwt);
    console.log("Token guardado.");
    await validateAndPrint(jwt);
    return;
  }

  // Plan B — importar desde un HAR exportado de DevTools.
  if (opts.fromHar) {
    let content: string;
    try {
      content = await readFile(opts.fromHar, "utf-8");
    } catch {
      console.error(`Error: no se pudo leer el HAR: ${opts.fromHar}`);
      process.exit(1);
    }
    const jwt = extractTokenFromHar(opts.fromHar, content);
    if (!jwt) {
      console.error(
        `No se encontró ningún header Authorization: Bearer en requests a ${API_HOST} en el HAR.`
      );
      console.error("Verifica que el HAR incluya requests autenticados al panel (no solo el login).");
      process.exit(1);
    }
    await saveToken(jwt);
    console.log("Token extraído del HAR y guardado.");

    const paciente = extractPacienteFromHar(content);
    if (paciente) {
      await savePaciente(paciente);
      console.log(`Paciente guardado: ${pacienteLabel(paciente)}`);
    }

    await validateAndPrint(jwt);
    return;
  }

  // Plan A — navegador headed + captura automática (Playwright).
  const result = await loginWithBrowser();
  if (result) {
    await saveToken(result.jwt);
    if (result.paciente) {
      await savePaciente(result.paciente);
      console.log(`Paciente guardado: ${pacienteLabel(result.paciente)}`);
    }
    try {
      await validateAndPrint(result.jwt);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
    return;
  }

  // Falló la captura automática → ofrecer los caminos manuales.
  console.error();
  console.error("No se pudo capturar el token automáticamente.");
  console.error("Posibles causas: no completaste el login, Turnstile bloqueó, o cerraste el navegador.");
  console.error();
  console.error("Opciones para continuar:");
  console.error();
  console.error("  Opción A — pegar el token manualmente:");
  console.error("    1. Abre https://miconsulta.essalud.gob.pe en Chrome");
  console.error("    2. Inicia sesión y abre DevTools (F12) → Network");
  console.error("    3. Filtra por 'api.miconsulta' → haz click en cualquier request");
  console.error("    4. En Headers, copia el valor de: Authorization: Bearer <token>");
  console.error("    5. Corre:");
  console.error("         essalud login --token <token>");
  console.error();
  console.error("  Opción B — importar desde HAR:");
  console.error("    1. En DevTools → Network → Export HAR (ícono de descarga)");
  console.error("    2. Corre:");
  console.error("         essalud login --from-har ~/Downloads/captura.har");
  console.error();

  process.exit(1);
}
