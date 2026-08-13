import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeCupos, type WatchTarget } from "./watch.js";
import type { WatchSnapshot } from "./watch-state.js";
import {
  loadWatchState,
  saveWatchState,
  WATCH_STATE_VERSION,
  watchStatePath,
} from "./watch-state.js";

const target: WatchTarget = {
  codCentro: "021",
  codServicioHosp: "F11",
  codActSubAct: "B1010",
};

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "essalud-watch-test-"));
  directories.push(directory);
  return directory;
}

function snapshot(): WatchSnapshot {
  return {
    version: WATCH_STATE_VERSION,
    target,
    updatedAt: "2026-08-13T02:00:00.000Z",
    slots: normalizeCupos([
      {
        apeNomProf: "Médica Uno",
        codProgAsis: "programacion-1",
        consultorio: "0203",
        fechaCitaProg: "04/09/2026",
        turnoIni: "07:00",
        turnoFin: "13:00",
        vCupoDisp: [{ hora: "07:00", nroCupo: 1 }],
      },
    ]),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("watchStatePath", () => {
  it("crea rutas distintas y seguras para cada búsqueda", async () => {
    const directory = await temporaryDirectory();
    const first = watchStatePath(target, directory);
    const second = watchStatePath({ ...target, codActSubAct: "../otra" }, directory);

    expect(first).not.toBe(second);
    expect(second.startsWith(directory)).toBe(true);
    expect(second).not.toContain("../");
  });

  it("no depende del orden de inserción de las propiedades", async () => {
    const directory = await temporaryDirectory();
    const reordered: WatchTarget = {
      codActSubAct: target.codActSubAct,
      codCentro: target.codCentro,
      codServicioHosp: target.codServicioHosp,
    };

    expect(watchStatePath(reordered, directory)).toBe(watchStatePath(target, directory));
  });
});

describe("persistencia del estado del monitoreo", () => {
  it("guarda y carga un estado con permisos privados", async () => {
    const directory = await temporaryDirectory();
    const path = watchStatePath(target, directory);
    const expected = snapshot();

    await saveWatchState(path, expected);

    expect(await loadWatchState(path)).toEqual(expected);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf-8")).toContain('"version": 1');
  });

  it("devuelve null cuando todavía no existe estado", async () => {
    const directory = await temporaryDirectory();
    expect(await loadWatchState(join(directory, "missing.json"))).toBeNull();
  });

  it("rechaza JSON corrupto o versiones incompatibles", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "state.json");

    await writeFile(path, "{invalid");
    await expect(loadWatchState(path)).rejects.toThrow(/JSON válido/);

    await writeFile(path, JSON.stringify({ ...snapshot(), version: 99 }));
    await expect(loadWatchState(path)).rejects.toThrow(/formato incompatible/);
  });
});
