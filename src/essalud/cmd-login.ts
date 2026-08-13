import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Browser, chromium } from "playwright";
import {
  type Credenciales,
  getPaciente,
  getPerfil,
  PACIENTE_PATH,
  type PacienteData,
  type Perfil,
  parseCredenciales,
  readRefreshToken,
  renovarSesion,
  saveCredenciales,
} from "./api.js";
import {
  extractCredencialesFromHar,
  extractPacienteFromHar,
  extractTokenFromHar,
  parsePacienteFromLgBody,
} from "./har.js";
import { decodeJwtPayload, JWT_RE, looksLikeEsSaludJwt } from "./jwt.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// El portal migró de miconsulta.essalud.gob.pe a digital.essalud.gob.pe (la URL
// vieja redirige). La API, en cambio, sigue en api.miconsulta.
const LOGIN_URL = "https://digital.essalud.gob.pe/login";
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
  /** Renew the session using the stored refresh token. */
  renovar?: boolean;
}

// ---------------------------------------------------------------------------
// Login por navegador (Playwright)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Navegadores Chromium del sistema, en orden de preferencia.
 * El Chromium que trae Playwright es rechazado por el Turnstile del portal
 * ("No pudimos completar el inicio de sesión"), así que preferimos un binario real.
 */
const SYSTEM_BROWSERS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "Brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
  { name: "Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
  { name: "Chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
  { name: "Brave", path: "/usr/bin/brave-browser" },
  { name: "Chrome", path: "/usr/bin/google-chrome" },
  { name: "Chromium", path: "/usr/bin/chromium" },
];

function findSystemBrowser(): { name: string; path: string } | null {
  return SYSTEM_BROWSERS.find((b) => existsSync(b.path)) ?? null;
}

/**
 * Abre un navegador real (headed), espera a que el usuario se loguee y captura
 * el Bearer token y los datos del paciente directamente de la red.
 * Devuelve null si no se pudo capturar (timeout, navegador cerrado, etc.).
 */
async function loginWithBrowser(): Promise<{
  cred: Credenciales;
  paciente: PacienteData | null;
} | null> {
  let browser: Browser;
  const systemBrowser = findSystemBrowser();
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: systemBrowser?.path,
      // Sin esto Chromium expone navigator.webdriver y Turnstile rechaza el login.
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (err) {
    const msg = String(err);
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      console.error("\nFalta el navegador de Playwright. Instálalo una sola vez con:");
      console.error("  npx playwright install chromium\n");
    } else {
      console.error(`\nNo se pudo abrir el navegador: ${msg}\n`);
    }
    return null;
  }

  const context = await browser.newContext({
    locale: "es-PE",
    timezoneId: "America/Lima",
    viewport: null,
  });
  // Segundo cinturón: aunque el flag de arriba falle, ocultamos la marca de automatización.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  let cred: Credenciales | null = null;
  let paciente: PacienteData | null = null;

  // Capturar el par completo (access + refresh) y el paciente del body del login.
  // El portal nuevo no manda Authorization en sus requests, así que el body de
  // /api/lg es la única fuente del refresh token.
  context.on("response", async (res) => {
    if (!res.url().includes("/api/lg")) return;
    let body: string;
    try {
      body = await res.text();
    } catch {
      return;
    }
    if (!res.ok()) {
      console.log(`\n(el portal respondió ${res.status()} al login — reintenta en el navegador)`);
    }
    paciente = parsePacienteFromLgBody(body) ?? paciente;
    try {
      cred = parseCredenciales(JSON.parse(body)) ?? cred;
    } catch {
      // Body no-JSON: caemos al respaldo por regex de más abajo.
    }
    if (!cred) {
      const m = body.match(JWT_RE);
      if (m && looksLikeEsSaludJwt(m[0])) cred = { access_token: m[0] };
    }
  });

  // Respaldo: si el login ya ocurrió en otra pestaña, sirve cualquier Bearer
  // que viaje a la API (sin refresh token, pero al menos entra).
  context.on("request", (req) => {
    if (cred || !req.url().includes(API_HOST)) return;
    const auth = req.headers().authorization ?? "";
    const m = auth.match(/Bearer\s+(\S+)/i);
    if (m && looksLikeEsSaludJwt(m[1])) cred = { access_token: m[1] };
  });

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log();
  console.log("─".repeat(60));
  console.log(`Se abrió un navegador${systemBrowser ? ` (${systemBrowser.name})` : ""} en:`);
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
  while (!cred && !browserClosed && Date.now() - start < LOGIN_TIMEOUT_MS) {
    await sleep(500);
  }

  await browser.close().catch(() => {});

  if (!cred) return null;
  return { cred, paciente };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

async function savePaciente(paciente: PacienteData): Promise<void> {
  await mkdir(dirname(PACIENTE_PATH), { recursive: true });
  await writeFile(PACIENTE_PATH, `${JSON.stringify(paciente, null, 2)}\n`, {
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

  // /perfil ya no devuelve el nombre (el portal nuevo solo lo manda en el login),
  // así que lo tomamos del paciente guardado y caemos al documento del perfil.
  const paciente = await getPaciente();
  const nombre = paciente
    ? [paciente.apePaterno, paciente.apeMaterno, paciente.nombres].filter(Boolean).join(" ")
    : "";
  const quien =
    nombre || (perfil.numeroDocIdent ? `documento ${perfil.numeroDocIdent}` : "asegurado");

  const payload = decodeJwtPayload(jwt);
  let expInfo = "";
  if (payload?.exp) {
    const expDate = new Date(payload.exp * 1000);
    expInfo = ` | Expira: ${expDate.toLocaleString("es-PE", { timeZone: "America/Lima" })}`;
  }

  console.log(`\n✓ Logueado como: ${quien}${expInfo}`);

  if (await readRefreshToken()) {
    console.log("  Renovación automática activa: mientras uses el CLI cada 24h, no");
    console.log("  necesitas volver a loguearte (o corre `essalud login --renovar`).");
  } else {
    console.log("  Sin refresh token: al vencer tendrás que loguearte de nuevo.");
  }
}

// ---------------------------------------------------------------------------
// Comando principal
// ---------------------------------------------------------------------------

export async function cmdLogin(opts: LoginOptions = {}): Promise<void> {
  // Renovar con el refresh token guardado: sin navegador y sin captcha.
  if (opts.renovar) {
    const jwt = await renovarSesion();
    if (!jwt) {
      console.error("No se pudo renovar la sesión.");
      console.error("El refresh token no existe o ya venció (dura 24h como el access token).");
      console.error("Corre `essalud login` para iniciar sesión de nuevo.");
      process.exit(1);
    }
    console.log("Sesión renovada.");
    await validateAndPrint(jwt);
    return;
  }

  // Plan B — token pegado a mano.
  if (opts.token) {
    const jwt = opts.token.trim().replace(/^Bearer\s+/i, "");
    if (!jwt.startsWith("ey")) {
      console.error("Error: el token no parece un JWT válido (debería empezar con 'ey...').");
      process.exit(1);
    }
    await saveCredenciales({ access_token: jwt });
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
    // El body de /api/lg trae el par completo; el escaneo de Bearer es el respaldo
    // para HARs que solo capturaron requests ya autenticados.
    const cred = extractCredencialesFromHar(content) ?? {
      access_token: extractTokenFromHar(opts.fromHar, content) ?? "",
    };
    if (!cred.access_token) {
      console.error(
        `No se encontró ningún token en el HAR (ni en el body de /api/lg ni en un header Authorization a ${API_HOST}).`,
      );
      console.error("Verifica que el HAR incluya el login o requests autenticados al panel.");
      process.exit(1);
    }
    await saveCredenciales(cred);
    console.log(
      cred.refresh_token
        ? "Token y refresh token extraídos del HAR y guardados."
        : "Token extraído del HAR y guardado (sin refresh token: el HAR no incluía el login).",
    );

    const paciente = extractPacienteFromHar(content);
    if (paciente) {
      await savePaciente(paciente);
      console.log(`Paciente guardado: ${pacienteLabel(paciente)}`);
    }

    await validateAndPrint(cred.access_token);
    return;
  }

  // Plan A — navegador headed + captura automática (Playwright).
  const result = await loginWithBrowser();
  if (result) {
    await saveCredenciales(result.cred);
    if (result.paciente) {
      await savePaciente(result.paciente);
      console.log(`Paciente guardado: ${pacienteLabel(result.paciente)}`);
    }
    try {
      await validateAndPrint(result.cred.access_token);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
    return;
  }

  // Falló la captura automática → ofrecer los caminos manuales.
  console.error();
  console.error("No se pudo capturar el token automáticamente.");
  console.error(
    "Posibles causas: no completaste el login, Turnstile bloqueó, o cerraste el navegador.",
  );
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
