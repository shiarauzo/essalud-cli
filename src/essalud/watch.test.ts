import { describe, expect, it } from "vitest";
import type { Cupo } from "./api.js";
import {
  findNewSlots,
  MIN_WATCH_INTERVAL_MS,
  normalizeCupos,
  parseWatchInterval,
} from "./watch.js";

function cupo(overrides: Partial<Cupo> = {}): Cupo {
  return {
    apeNomProf: "Médica Uno",
    codProgAsis: "programacion-1",
    consultorio: "0203",
    fechaCitaProg: "04/09/2026",
    turnoIni: "07:00",
    turnoFin: "13:00",
    vCupoDisp: [{ hora: "07:00", nroCupo: 1 }],
    ...overrides,
  };
}

describe("parseWatchInterval", () => {
  it.each([
    ["120s", MIN_WATCH_INTERVAL_MS],
    ["2m", 120_000],
    ["5m", 300_000],
    ["1h", 3_600_000],
  ])("convierte %s a milisegundos", (input, expected) => {
    expect(parseWatchInterval(input)).toBe(expected);
  });

  it.each(["", "5", "1.5m", "mañana", "1m", "119s"])("rechaza %s", (input) => {
    expect(() => parseWatchInterval(input)).toThrow();
  });
});

describe("normalizeCupos", () => {
  it("aplana los turnos y conserva los datos necesarios para reservar", () => {
    const slots = normalizeCupos([
      cupo({
        vCupoDisp: [
          { hora: "07:00", nroCupo: 1 },
          { hora: "07:15", nroCupo: 2 },
        ],
      }),
    ]);

    expect(slots).toHaveLength(2);
    expect(slots[1]).toMatchObject({
      apeNomProf: "Médica Uno",
      fechaCitaProg: "04/09/2026",
      consultorio: "0203",
      hora: "07:15",
      nroCupo: 2,
    });
  });

  it("no colisiona cuando EsSalud reutiliza programación y número en otra fecha", () => {
    const slots = normalizeCupos([
      cupo({ fechaCitaProg: "04/09/2026" }),
      cupo({ fechaCitaProg: "05/09/2026" }),
    ]);

    expect(slots).toHaveLength(2);
    expect(slots[0].key).not.toBe(slots[1].key);
  });

  it("no colisiona entre turnos, horas o consultorios", () => {
    const slots = normalizeCupos([
      cupo(),
      cupo({ turnoIni: "13:00", turnoFin: "18:00", vCupoDisp: [{ hora: "13:00", nroCupo: 1 }] }),
      cupo({ consultorio: "0204" }),
    ]);

    expect(new Set(slots.map((slot) => slot.key))).toHaveLength(3);
  });

  it("elimina duplicados exactos de la respuesta", () => {
    expect(normalizeCupos([cupo(), cupo()])).toHaveLength(1);
  });

  it("descarta números de cupo que no sean enteros finitos", () => {
    const slots = normalizeCupos([
      cupo({
        vCupoDisp: [
          { hora: "07:00", nroCupo: Number.NaN },
          { hora: "07:15", nroCupo: Number.POSITIVE_INFINITY },
          { hora: "07:30", nroCupo: "1; touch /tmp/pwned" as unknown as number },
          { hora: "07:45", nroCupo: 4 },
        ],
      }),
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0].nroCupo).toBe(4);
  });
});

describe("findNewSlots", () => {
  it("devuelve únicamente los slots que no estaban en el snapshot anterior", () => {
    const previous = normalizeCupos([cupo()]);
    const current = normalizeCupos([
      cupo(),
      cupo({ fechaCitaProg: "05/09/2026", vCupoDisp: [{ hora: "08:00", nroCupo: 5 }] }),
    ]);

    expect(findNewSlots(previous, current)).toEqual([current[1]]);
  });

  it("trata como nuevo un slot que reaparece después de un snapshot vacío", () => {
    const current = normalizeCupos([cupo()]);
    expect(findNewSlots([], current)).toEqual(current);
  });
});

describe("estrés con miles de cupos", () => {
  // Verifica que la normalización y el diff son correctos a gran escala:
  // duplicados exactos, valores inválidos de nroCupo y conjuntos parcialmente solapados.
  it("normaliza miles de cupos con duplicados y nroCupo inválidos sin errores ni colisiones", () => {
    const CUPOS_UNICOS = 300;
    const SLOTS_VALIDOS_POR_CUPO = 4;

    const base: Cupo[] = Array.from({ length: CUPOS_UNICOS }, (_, i) => ({
      apeNomProf: `Médico ${i}`,
      // codProgAsis único por cupo garantiza que ningún par comparte clave completa
      codProgAsis: `prog-${i}`,
      consultorio: String(i).padStart(4, "0"),
      fechaCitaProg: `${String((i % 28) + 1).padStart(2, "0")}/09/2026`,
      turnoIni: "07:00",
      turnoFin: "13:00",
      vCupoDisp: [
        // Slots válidos: horas 07:00–10:00, nroCupo 1–4
        ...Array.from({ length: SLOTS_VALIDOS_POR_CUPO }, (_, j) => ({
          hora: `${String(7 + j).padStart(2, "0")}:00`,
          nroCupo: j + 1,
        })),
        // Slots inválidos que deben descartarse
        { hora: "11:00", nroCupo: Number.NaN },
        { hora: "11:30", nroCupo: Number.POSITIVE_INFINITY },
        { hora: "11:45", nroCupo: "1; rm -rf /" as unknown as number },
        { hora: "12:00", nroCupo: 1.5 },
      ],
    }));

    // Agrega 50 duplicados exactos al inicio para verificar deduplicación a escala
    const cuposConDuplicados: Cupo[] = [...base.slice(0, 50), ...base];

    const slots = normalizeCupos(cuposConDuplicados);

    // Solo los slots válidos y únicos sobreviven
    expect(slots).toHaveLength(CUPOS_UNICOS * SLOTS_VALIDOS_POR_CUPO);
    expect(slots.every((s) => Number.isSafeInteger(s.nroCupo))).toBe(true);

    // Todas las claves son únicas (sin colisiones por el Map interno)
    const claves = slots.map((s) => s.key);
    expect(new Set(claves).size).toBe(slots.length);

    // findNewSlots: la primera mitad como "anterior" → exactamente la segunda mitad es nueva
    const mitad = Math.floor(slots.length / 2);
    const nuevos = findNewSlots(slots.slice(0, mitad), slots);
    expect(nuevos).toHaveLength(slots.length - mitad);

    // Ningún slot de la mitad anterior aparece entre los nuevos
    const clavesAnteriores = new Set(slots.slice(0, mitad).map((s) => s.key));
    expect(nuevos.every((s) => !clavesAnteriores.has(s.key))).toBe(true);
  });
});
