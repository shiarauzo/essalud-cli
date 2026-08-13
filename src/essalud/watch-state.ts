import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WatchSlot, WatchTarget } from "./watch.js";

export const WATCH_STATE_VERSION = 1;
export const WATCH_STATE_DIR = join(homedir(), ".essalud", "watch");

export interface WatchSnapshot {
  version: typeof WATCH_STATE_VERSION;
  target: WatchTarget;
  updatedAt: string;
  slots: WatchSlot[];
}

function safeSegment(value: string): string {
  return (
    value
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "target"
  );
}

export function watchStatePath(target: WatchTarget, stateDir = WATCH_STATE_DIR): string {
  const canonicalTarget = [target.codCentro, target.codServicioHosp, target.codActSubAct].join(
    "\u0000",
  );
  const digest = createHash("sha256").update(canonicalTarget).digest("hex").slice(0, 10);
  const label = [target.codCentro, target.codServicioHosp, target.codActSubAct]
    .map(safeSegment)
    .join("-");
  return join(stateDir, `${label}-${digest}.json`);
}

function isWatchSnapshot(value: unknown): value is WatchSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Partial<WatchSnapshot>;
  return (
    snapshot.version === WATCH_STATE_VERSION &&
    typeof snapshot.updatedAt === "string" &&
    typeof snapshot.target?.codCentro === "string" &&
    typeof snapshot.target.codServicioHosp === "string" &&
    typeof snapshot.target.codActSubAct === "string" &&
    Array.isArray(snapshot.slots) &&
    snapshot.slots.every((slot) => typeof slot?.key === "string")
  );
}

export async function loadWatchState(path: string): Promise<WatchSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`El estado de watch no contiene JSON válido: ${path}`);
  }

  if (!isWatchSnapshot(parsed)) {
    throw new Error(`El estado de watch tiene un formato incompatible: ${path}`);
  }
  return parsed;
}

export async function saveWatchState(path: string, snapshot: WatchSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
