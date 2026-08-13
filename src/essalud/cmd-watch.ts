import {
  type Cupo,
  getProgramacionDisponible,
  HttpError,
  readToken,
  renovarSesion,
} from "./api.js";
import { decodeJwtPayload } from "./jwt.js";
import {
  DEFAULT_WATCH_INTERVAL_MS,
  findNewSlots,
  normalizeCupos,
  parseWatchInterval,
  type WatchTarget,
} from "./watch.js";
import { createNotifier, type Notifier, type NotifyMode } from "./watch-notifier.js";
import {
  loadWatchState,
  saveWatchState,
  WATCH_STATE_VERSION,
  type WatchSnapshot,
  watchStatePath,
} from "./watch-state.js";

const MAX_BACKOFF_MS = 30 * 60 * 1000;
const REGULAR_JITTER = 0.05;

export interface WatchOptions {
  interval?: string;
  notify?: string;
}

export interface WatchDependencies {
  getCupos(target: WatchTarget): Promise<Cupo[]>;
  readAccessToken(): Promise<string>;
  renewSession(): Promise<string | null>;
  loadState(path: string): Promise<WatchSnapshot | null>;
  saveState(path: string, snapshot: WatchSnapshot): Promise<void>;
  notifier: Notifier;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  random(): number;
  log(message: string): void;
  warn(message: string): void;
  statePath(target: WatchTarget): string;
}

export type WatchResult = "stopped" | "auth-expired" | "fatal-error";

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function defaultDependencies(notifier: Notifier): WatchDependencies {
  return {
    getCupos: (target) =>
      getProgramacionDisponible({
        ...target,
        codTurnoDeseado: "0",
      }),
    readAccessToken: readToken,
    renewSession: renovarSesion,
    loadState: loadWatchState,
    saveState: saveWatchState,
    notifier,
    sleep: defaultSleep,
    now: Date.now,
    random: Math.random,
    log: console.log,
    warn: console.warn,
    statePath: watchStatePath,
  };
}

function targetMatches(first: WatchTarget, second: WatchTarget): boolean {
  return (
    first.codCentro === second.codCentro &&
    first.codServicioHosp === second.codServicioHosp &&
    first.codActSubAct === second.codActSubAct
  );
}

function tokenExpired(token: string, now: number): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" && payload.exp * 1000 <= now;
}

function authenticationStatus(error: unknown): number | null {
  if (!(error instanceof HttpError)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

function withJitter(value: number, random: number, proportion: number): number {
  const factor = 1 - proportion + random * proportion * 2;
  return Math.max(1, Math.round(value * factor));
}

async function ensureActiveSession(dependencies: WatchDependencies): Promise<"active" | "expired"> {
  let token: string;
  try {
    token = await dependencies.readAccessToken();
  } catch {
    await dependencies.notifier.notifySessionExpired();
    return "expired";
  }
  if (!tokenExpired(token, dependencies.now())) return "active";

  const renewed = await dependencies.renewSession();
  if (renewed) return "active";

  await dependencies.notifier.notifySessionExpired();
  return "expired";
}

async function loadPreviousSnapshot(
  target: WatchTarget,
  path: string,
  dependencies: WatchDependencies,
): Promise<WatchSnapshot | null> {
  try {
    const snapshot = await dependencies.loadState(path);
    if (snapshot && !targetMatches(snapshot.target, target)) {
      dependencies.warn(`El estado guardado pertenece a otro watch; se creará un baseline nuevo.`);
      return null;
    }
    return snapshot;
  } catch (error) {
    dependencies.warn(`${String(error)}. Se creará un baseline nuevo sin enviar alertas.`);
    return null;
  }
}

export async function runWatch(
  target: WatchTarget,
  intervalMs: number,
  signal: AbortSignal,
  dependencies: WatchDependencies,
): Promise<WatchResult> {
  const path = dependencies.statePath(target);
  let previousSnapshot = await loadPreviousSnapshot(target, path, dependencies);
  let failures = 0;

  dependencies.log(
    `Monitoreando centro=${target.codCentro} servicio=${target.codServicioHosp} actividad=${target.codActSubAct}.`,
  );
  dependencies.log(`Intervalo: ${Math.round(intervalMs / 1000)}s · Estado: ${path}`);
  dependencies.log("Presiona Ctrl+C para detener.\n");

  while (!signal.aborted) {
    try {
      if ((await ensureActiveSession(dependencies)) === "expired") return "auth-expired";

      const cupos = await dependencies.getCupos(target);
      const currentSlots = normalizeCupos(cupos);
      const newSlots = previousSnapshot ? findNewSlots(previousSnapshot.slots, currentSlots) : [];
      const snapshot: WatchSnapshot = {
        version: WATCH_STATE_VERSION,
        target,
        updatedAt: new Date(dependencies.now()).toISOString(),
        slots: currentSlots,
      };

      if (newSlots.length > 0) {
        await dependencies.notifier.notify({ target, slots: newSlots });
      }

      try {
        await dependencies.saveState(path, snapshot);
      } catch (error) {
        dependencies.warn(`No se pudo guardar el estado (${String(error)}).`);
        dependencies.warn(
          "El monitoreo continuará en memoria; al reiniciar podrían repetirse alertas.",
        );
      }
      previousSnapshot = snapshot;
      failures = 0;

      dependencies.log(
        `[${new Date(dependencies.now()).toLocaleTimeString("es-PE")}] ${currentSlots.length} slots disponibles · ${newSlots.length} nuevos`,
      );

      await dependencies.sleep(
        withJitter(intervalMs, dependencies.random(), REGULAR_JITTER),
        signal,
      );
    } catch (error) {
      if (signal.aborted) break;

      const authStatus = authenticationStatus(error);
      if (authStatus) {
        const token = await dependencies.readAccessToken().catch(() => "");
        if (!token || tokenExpired(token, dependencies.now())) {
          await dependencies.notifier.notifySessionExpired();
          return "auth-expired";
        }
        dependencies.warn(
          `EsSalud rechazó una sesión todavía vigente (HTTP ${authStatus}). Corre \`essalud login\` y vuelve a intentarlo.`,
        );
        return "fatal-error";
      }

      if (!isTransientError(error)) {
        dependencies.warn(`El watch se detuvo: ${String(error)}`);
        return "fatal-error";
      }

      failures += 1;
      const backoff = Math.min(intervalMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
      const delay = withJitter(backoff, dependencies.random(), REGULAR_JITTER);
      dependencies.warn(
        `Consulta fallida (${String(error)}). Reintentando en ${Math.ceil(delay / 1000)}s.`,
      );
      await dependencies.sleep(delay, signal);
    }
  }

  dependencies.log("\nWatch detenido.");
  return "stopped";
}

function parseNotifyMode(value: string): NotifyMode {
  if (value === "terminal" || value === "desktop") return value;
  throw new Error("Notificador inválido. Usa terminal o desktop.");
}

export async function cmdWatch(
  codCentro: string,
  codServicioHosp: string,
  codActSubAct: string,
  options: WatchOptions = {},
): Promise<void> {
  let intervalMs: number;
  let notifyMode: NotifyMode;
  try {
    intervalMs =
      options.interval === undefined
        ? DEFAULT_WATCH_INTERVAL_MS
        : parseWatchInterval(options.interval);
    notifyMode = parseNotifyMode(options.notify ?? "terminal");
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const result = await runWatch(
      { codCentro, codServicioHosp, codActSubAct },
      intervalMs,
      controller.signal,
      defaultDependencies(createNotifier(notifyMode)),
    );
    if (result !== "stopped") process.exitCode = 1;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
