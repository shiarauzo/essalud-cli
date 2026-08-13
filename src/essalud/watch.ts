import type { Cupo } from "./api.js";

export const DEFAULT_WATCH_INTERVAL_MS = 5 * 60 * 1000;
export const MIN_WATCH_INTERVAL_MS = 2 * 60 * 1000;

export interface WatchTarget {
  codCentro: string;
  codServicioHosp: string;
  codActSubAct: string;
}

export interface WatchSlot {
  key: string;
  apeNomProf: string;
  codProgAsis: string;
  consultorio: string;
  fechaCitaProg: string;
  turnoIni: string;
  turnoFin: string;
  hora: string;
  nroCupo: number;
}

export function parseWatchInterval(value: string): number {
  const match = /^(\d+)(s|m|h)$/i.exec(value.trim());
  if (!match) {
    throw new Error("Intervalo inválido. Usa un entero seguido de s, m o h (por ejemplo, 5m).");
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  const intervalMs = amount * multiplier;

  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_WATCH_INTERVAL_MS) {
    throw new Error("El intervalo mínimo para consultar EsSalud es 2m.");
  }

  return intervalMs;
}

export function watchSlotKey(slot: Omit<WatchSlot, "key" | "apeNomProf" | "turnoFin">): string {
  return JSON.stringify([
    slot.fechaCitaProg,
    slot.codProgAsis,
    slot.consultorio,
    slot.turnoIni,
    slot.hora,
    slot.nroCupo,
  ]);
}

export function normalizeCupos(cupos: Cupo[]): WatchSlot[] {
  const slots = new Map<string, WatchSlot>();

  for (const cupo of cupos) {
    for (const slot of cupo.vCupoDisp ?? []) {
      if (!Number.isSafeInteger(slot.nroCupo)) continue;

      const normalizedWithoutKey = {
        apeNomProf: cupo.apeNomProf,
        codProgAsis: cupo.codProgAsis,
        consultorio: cupo.consultorio,
        fechaCitaProg: cupo.fechaCitaProg,
        turnoIni: cupo.turnoIni,
        turnoFin: cupo.turnoFin,
        hora: slot.hora,
        nroCupo: slot.nroCupo,
      };
      const key = watchSlotKey(normalizedWithoutKey);
      slots.set(key, { key, ...normalizedWithoutKey });
    }
  }

  return [...slots.values()];
}

export function findNewSlots(previous: WatchSlot[], current: WatchSlot[]): WatchSlot[] {
  const previousKeys = new Set(previous.map((slot) => slot.key));
  return current.filter((slot) => !previousKeys.has(slot.key));
}
