import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { TOKEN_PATH, PACIENTE_PATH, getPerfil, type Perfil, type PacienteData } from "./api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_BROWSER = "node /Users/shiara/Documents/personal-projects/agent-browser/bin/agent-browser.js";
const SESSION_NAME = "essalud";
const LOGIN_URL = "https://miconsulta.essalud.gob.pe/login";
const API_HOST = "api.miconsulta.essalud.gob.pe";

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
// Helpers — run agent-browser command and capture stdout
// ---------------------------------------------------------------------------

async function ab(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Split "node /path/to/script.js" prefix from args
    const [nodeExe, scriptPath] = AGENT_BROWSER.split(" ");
    const child = spawn(nodeExe, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENT_BROWSER_SESSION: SESSION_NAME },
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));

    child.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8").trim();
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf-8").trim();
        reject(new Error(`agent-browser ${args[0]} failed (exit ${code}): ${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", reject);
  });
}

/** Run agent-browser with the browser window visible (--headed), inheriting stdio. */
async function abHeaded(...args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [nodeExe, scriptPath] = AGENT_BROWSER.split(" ");
    const child = spawn(nodeExe, [scriptPath, "--headed", ...args], {
      stdio: "inherit",
      env: { ...process.env, AGENT_BROWSER_SESSION: SESSION_NAME, AGENT_BROWSER_HEADED: "1" },
    });

    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`agent-browser ${args[0]} failed (exit ${code})`));
      else resolve();
    });

    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// HAR parsing
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

/** Extract the most-recent Bearer JWT from a HAR file. */
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
    const authHeader = req?.headers?.find(
      (h) => h.name.toLowerCase() === "authorization"
    );
    const authMatch = authHeader?.value.match(/Bearer\s+(\S+)/i);
    if (authMatch && looksLikeEsSaludJwt(authMatch[1])) candidates.push(authMatch[1]);

    // 2) JWT embebido en el body de respuesta (el login /api/lg devuelve el token
    //    ahí; Chrome NO exporta el header Authorization al HAR, pero sí el body).
    for (const blob of [resp?.content?.text ?? "", req?.postData?.text ?? ""]) {
      const m = blob.match(JWT_RE);
      if (m && looksLikeEsSaludJwt(m[0])) candidates.push(m[0]);
    }
  }

  if (candidates.length === 0) return null;
  // El más reciente (HARs son cronológicos).
  return candidates[candidates.length - 1];
}

// ---------------------------------------------------------------------------
// localStorage / sessionStorage / IndexedDB fallback via eval
// ---------------------------------------------------------------------------

/** Try to read the JWT from browser storage via JS eval. */
async function extractTokenFromBrowserStorage(): Promise<string | null> {
  const jsSnippet = `
    (function() {
      // Flutter web apps often store tokens in localStorage
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        var val = localStorage.getItem(keys[i]);
        if (val && /^ey[A-Za-z0-9_-]+\\.ey[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
        // Some apps store JSON with a token field
        if (val && val.startsWith('{')) {
          try {
            var obj = JSON.parse(val);
            if (obj.token && typeof obj.token === 'string') return obj.token;
            if (obj.accessToken && typeof obj.accessToken === 'string') return obj.accessToken;
            if (obj.jwt && typeof obj.jwt === 'string') return obj.jwt;
          } catch(e) {}
        }
      }
      // Also check sessionStorage
      keys = Object.keys(sessionStorage);
      for (var i = 0; i < keys.length; i++) {
        var val = sessionStorage.getItem(keys[i]);
        if (val && /^ey[A-Za-z0-9_-]+\\.ey[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/.test(val)) {
          return val;
        }
      }
      return null;
    })()
  `.trim();

  try {
    const result = await ab("eval", jsSnippet);
    // agent-browser eval returns the stringified result; null comes back as "null"
    if (result && result !== "null" && result.startsWith("ey")) {
      return result.trim().replace(/^"(.*)"$/, "$1"); // strip surrounding quotes if any
    }
  } catch {
    // Ignore eval errors — storage might not be accessible
  }

  return null;
}

// ---------------------------------------------------------------------------
// network requests fallback — read from live capture
// ---------------------------------------------------------------------------

async function extractTokenFromNetworkRequests(): Promise<string | null> {
  try {
    const output = await ab("network", "requests", "--json", "--filter", API_HOST);
    if (!output || output === "null" || output === "[]") return null;

    // Parse as JSON array of request objects
    const requests = JSON.parse(output) as Array<{
      url?: string;
      headers?: Record<string, string>;
      requestHeaders?: Record<string, string>;
    }>;

    // Scan in reverse (most recent first)
    for (let i = requests.length - 1; i >= 0; i--) {
      const req = requests[i];
      const headers = req.headers ?? req.requestHeaders ?? {};
      const authValue = headers["authorization"] ?? headers["Authorization"] ?? "";
      const match = authValue.match(/^Bearer\s+(.+)$/i);
      if (match) return match[1].trim();
    }
  } catch {
    // Not fatal — try other methods
  }

  return null;
}

// ---------------------------------------------------------------------------
// JWT decode (no verify — just read exp)
// ---------------------------------------------------------------------------

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
    // Add padding
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as JwtPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Save token
// ---------------------------------------------------------------------------

async function saveToken(jwt: string): Promise<void> {
  const dir = dirname(TOKEN_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(TOKEN_PATH, jwt + "\n", { encoding: "utf-8", mode: 0o600 });
  // Ensure permissions (writeFile mode may be masked by umask)
  await chmod(TOKEN_PATH, 0o600);
}

// ---------------------------------------------------------------------------
// Save paciente
// ---------------------------------------------------------------------------

async function savePaciente(paciente: PacienteData): Promise<void> {
  const dir = dirname(PACIENTE_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(PACIENTE_PATH, JSON.stringify(paciente, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(PACIENTE_PATH, 0o600);
}

/** Busca la entry /api/lg en el HAR y extrae datos del paciente de la respuesta JSON. */
function extractPacienteFromHar(harContent: string): PacienteData | null {
  let har: { log?: { entries?: HarEntry[] } };
  try {
    har = JSON.parse(harContent) as { log?: { entries?: HarEntry[] } };
  } catch {
    return null;
  }

  const entries = har.log?.entries ?? [];

  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    // Buscar entry del endpoint de login (/api/lg o similar)
    if (!url.includes("/api/lg")) continue;

    const responseText = entry.response?.content?.text ?? "";
    if (!responseText) continue;

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
      if (!raw) continue;

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
      // Seguir buscando en otras entries
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validate token by calling /perfil
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
// Main command
// ---------------------------------------------------------------------------

export async function cmdLogin(opts: LoginOptions = {}): Promise<void> {
  // -------------------------------------------------------------------------
  // Plan B: --token <jwt>
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Plan B: --from-har <path>
  // -------------------------------------------------------------------------
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
      console.error("Verificá que el HAR incluya requests autenticados al panel (no solo el login).");
      process.exit(1);
    }
    await saveToken(jwt);
    console.log("Token extraído del HAR y guardado.");

    // Intentar extraer y guardar datos del paciente desde /api/lg
    const paciente = extractPacienteFromHar(content);
    if (paciente) {
      await savePaciente(paciente);
      console.log(`Paciente guardado: ${[paciente.apePaterno, paciente.apeMaterno, paciente.nombres].filter(Boolean).join(" ")} · ${paciente.desCentro}`);
    }

    await validateAndPrint(jwt);
    return;
  }

  // -------------------------------------------------------------------------
  // Plan A: browser headed + captura automática
  // -------------------------------------------------------------------------
  const harPath = join(tmpdir(), `essalud-login-${Date.now()}.har`);

  // Step 1 — open browser headed and start network capture
  console.log("Abriendo browser...");
  try {
    await abHeaded("open", LOGIN_URL, "--wait-for", "load");
  } catch (err) {
    // Even if wait-for fails, the browser may have opened — continue
    console.error(`Advertencia al abrir browser: ${String(err)}`);
  }

  // Start HAR capture (best-effort; agent-browser daemon persists across calls)
  try {
    await ab("network", "har", "start", harPath);
  } catch {
    // If HAR start fails, we'll rely on the network requests fallback
  }

  // Step 2 — instructions to user
  console.log();
  console.log("─".repeat(60));
  console.log("Se abrió un browser en:");
  console.log(`  ${LOGIN_URL}`);
  console.log();
  console.log("Pasos:");
  console.log("  1. Ingresá tu DNI y clave en el browser.");
  console.log("  2. Completá el captcha de Cloudflare Turnstile.");
  console.log("  3. Esperá a ver tu panel/home (lista de citas).");
  console.log("  4. Volvé a esta terminal y presioná ENTER.");
  console.log("─".repeat(60));

  // Step 3 — wait for user
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\nCuando veas tu panel, presioná ENTER...");
  rl.close();

  // Step 4 — stop HAR and extract token
  let jwt: string | null = null;

  // 4a. Stop HAR and parse it
  try {
    await ab("network", "har", "stop", harPath);
    const harContent = await readFile(harPath, "utf-8");
    jwt = extractTokenFromHar(harPath, harContent);
  } catch {
    // HAR might not have captured auth headers (Flutter WASM quirk)
  }

  // 4b. Fallback: live network requests captured by agent-browser daemon
  if (!jwt) {
    jwt = await extractTokenFromNetworkRequests();
  }

  // 4c. Fallback: read from localStorage/sessionStorage via eval
  if (!jwt) {
    jwt = await extractTokenFromBrowserStorage();
  }

  // Step 5 & 6 — save and validate, or show error
  if (jwt) {
    // Step 5 — save (don't print)
    await saveToken(jwt);

    // Step 6 — validate and print result
    try {
      await validateAndPrint(jwt);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }

    // Close browser session
    try {
      await ab("close");
    } catch {
      // Non-fatal
    }
  } else {
    // Step 7 — error + fallback instructions
    console.error();
    console.error("No se pudo capturar el token automáticamente.");
    console.error("Posibles causas: no te logueaste, Turnstile bloqueó, o la sesión expiró.");
    console.error();
    console.error("Opciones para continuar:");
    console.error();
    console.error("  Opción A — pegar el token manualmente:");
    console.error("    1. Abrí https://miconsulta.essalud.gob.pe en Chrome");
    console.error("    2. Logueate y abrí DevTools (F12) → Network");
    console.error("    3. Filtrá por 'api.miconsulta' → hacé click en cualquier request");
    console.error("    4. En Headers, copiá el valor de: Authorization: Bearer <token>");
    console.error("    5. Corré:");
    console.error("         tramites-pe essalud login --token <token>");
    console.error();
    console.error("  Opción B — importar desde HAR:");
    console.error("    1. En DevTools → Network → Export HAR (ícono de descarga)");
    console.error("    2. Corré:");
    console.error("         tramites-pe essalud login --from-har ~/Downloads/captura.har");
    console.error();

    try {
      await ab("close");
    } catch {
      // Non-fatal
    }

    process.exit(1);
  }
}
