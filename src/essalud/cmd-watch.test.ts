import { describe, expect, it, vi } from "vitest";
import { type Cupo, HttpError } from "./api.js";
import { runWatch, type WatchDependencies } from "./cmd-watch.js";
import { normalizeCupos, type WatchTarget } from "./watch.js";
import { WATCH_STATE_VERSION, type WatchSnapshot } from "./watch-state.js";

const target: WatchTarget = {
  codCentro: "021",
  codServicioHosp: "F11",
  codActSubAct: "B1010",
};

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

function jwt(exp: number): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

function snapshot(cupos: Cupo[]): WatchSnapshot {
  return {
    version: WATCH_STATE_VERSION,
    target,
    updatedAt: "2026-08-13T02:00:00.000Z",
    slots: normalizeCupos(cupos),
  };
}

function dependencies(
  controller: AbortController,
  overrides: Partial<WatchDependencies> = {},
): WatchDependencies {
  return {
    getCupos: vi.fn().mockResolvedValue([cupo()]),
    readAccessToken: vi.fn().mockResolvedValue(jwt(2_000_000_000)),
    renewSession: vi.fn().mockResolvedValue(null),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
      notifySessionExpired: vi.fn().mockResolvedValue(undefined),
    },
    sleep: vi.fn().mockImplementation(async () => controller.abort()),
    now: () => 1_786_586_400_000,
    random: () => 0.5,
    log: vi.fn(),
    warn: vi.fn(),
    statePath: () => "/tmp/watch-state.json",
    ...overrides,
  };
}

describe("runWatch", () => {
  it("guarda la primera consulta como estado inicial sin notificar", async () => {
    const controller = new AbortController();
    const deps = dependencies(controller);

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("stopped");
    expect(deps.notifier.notify).not.toHaveBeenCalled();
    expect(deps.saveState).toHaveBeenCalledWith(
      "/tmp/watch-state.json",
      expect.objectContaining({ slots: expect.any(Array) }),
    );
  });

  it("notifica únicamente los cupos añadidos desde el estado anterior", async () => {
    const controller = new AbortController();
    const previous = snapshot([cupo()]);
    const added = cupo({
      fechaCitaProg: "05/09/2026",
      vCupoDisp: [{ hora: "08:00", nroCupo: 5 }],
    });
    const deps = dependencies(controller, {
      loadState: vi.fn().mockResolvedValue(previous),
      getCupos: vi.fn().mockResolvedValue([cupo(), added]),
    });

    await runWatch(target, 300_000, controller.signal, deps);

    expect(deps.notifier.notify).toHaveBeenCalledOnce();
    expect(deps.notifier.notify).toHaveBeenCalledWith({
      target,
      slots: [expect.objectContaining({ fechaCitaProg: "05/09/2026", nroCupo: 5 })],
    });
  });

  it("persiste una respuesta vacía exitosa", async () => {
    const controller = new AbortController();
    const deps = dependencies(controller, {
      loadState: vi.fn().mockResolvedValue(snapshot([cupo()])),
      getCupos: vi.fn().mockResolvedValue([]),
    });

    await runWatch(target, 300_000, controller.signal, deps);

    expect(deps.saveState).toHaveBeenCalledWith(
      "/tmp/watch-state.json",
      expect.objectContaining({ slots: [] }),
    );
  });

  it("reintenta errores transitorios sin reemplazar el estado", async () => {
    const controller = new AbortController();
    let sleeps = 0;
    const getCupos = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce([cupo()]);
    const deps = dependencies(controller, {
      getCupos,
      sleep: vi.fn().mockImplementation(async () => {
        sleeps += 1;
        if (sleeps === 2) controller.abort();
      }),
    });

    await runWatch(target, 300_000, controller.signal, deps);

    expect(getCupos).toHaveBeenCalledTimes(2);
    expect(deps.saveState).toHaveBeenCalledOnce();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("Reintentando"));
  });

  it.each([429, 503])("reintenta respuestas HTTP %i", async (status) => {
    const controller = new AbortController();
    let sleeps = 0;
    const getCupos = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(status, "Error", "POST", "/programacionDisponible"))
      .mockResolvedValueOnce([cupo()]);
    const deps = dependencies(controller, {
      getCupos,
      sleep: vi.fn().mockImplementation(async () => {
        sleeps += 1;
        if (sleeps === 2) controller.abort();
      }),
    });

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("stopped");
    expect(getCupos).toHaveBeenCalledTimes(2);
    expect(deps.saveState).toHaveBeenCalledOnce();
  });

  it("detiene errores desconocidos sin reintentarlos", async () => {
    const controller = new AbortController();
    const deps = dependencies(controller, {
      getCupos: vi.fn().mockRejectedValue(new Error("fallo inesperado")),
    });

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("fatal-error");
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("El monitoreo se detuvo"));
  });

  it("renueva un access token vencido antes de consultar", async () => {
    const controller = new AbortController();
    const renewSession = vi.fn().mockResolvedValue(jwt(2_000_000_000));
    const deps = dependencies(controller, {
      readAccessToken: vi.fn().mockResolvedValue(jwt(1)),
      renewSession,
    });

    await runWatch(target, 300_000, controller.signal, deps);

    expect(renewSession).toHaveBeenCalledOnce();
    expect(renewSession).toHaveBeenCalledWith();
    expect(deps.getCupos).toHaveBeenCalledOnce();
  });

  it("reintenta si la renovación falla de forma transitoria", async () => {
    const controller = new AbortController();
    let sleeps = 0;
    const renewSession = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jwt(2_000_000_000));
    const deps = dependencies(controller, {
      readAccessToken: vi.fn().mockResolvedValue(jwt(1)),
      renewSession,
      sleep: vi.fn().mockImplementation(async () => {
        sleeps += 1;
        if (sleeps === 2) controller.abort();
      }),
    });

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("stopped");
    expect(renewSession).toHaveBeenCalledTimes(2);
    expect(deps.getCupos).toHaveBeenCalledOnce();
    expect(deps.notifier.notifySessionExpired).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("Reintentando"));
  });

  it("notifica y termina cuando la sesión vencida no se puede renovar", async () => {
    const controller = new AbortController();
    const deps = dependencies(controller, {
      readAccessToken: vi.fn().mockResolvedValue(jwt(1)),
    });

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("auth-expired");
    expect(deps.notifier.notifySessionExpired).toHaveBeenCalledOnce();
    expect(deps.getCupos).not.toHaveBeenCalled();
  });

  it("no confunde un 403 con token vigente con una expiración", async () => {
    const controller = new AbortController();
    const deps = dependencies(controller, {
      getCupos: vi.fn().mockRejectedValue(new HttpError(403, "Forbidden", "POST", "/x")),
    });

    expect(await runWatch(target, 300_000, controller.signal, deps)).toBe("fatal-error");
    expect(deps.notifier.notifySessionExpired).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("sesión todavía vigente"));
  });

  it("recorre estado inicial → sin cambios → fallo transitorio → cupo nuevo → sin cambios; genera una notificación", async () => {
    // Este test agrupa los cinco escenarios en una sola ejecución de runWatch
    // para probar que el estado sobrevive el fallo y que no se duplican alertas.
    const controller = new AbortController();

    const slotA = cupo();
    const slotB = cupo({
      fechaCitaProg: "05/09/2026",
      vCupoDisp: [{ hora: "08:00", nroCupo: 5 }],
    });

    const getCupos = vi
      .fn()
      .mockResolvedValueOnce([slotA])
      .mockResolvedValueOnce([slotA])
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce([slotA, slotB])
      .mockResolvedValueOnce([slotA, slotB]);

    let sleepCount = 0;
    const sleep = vi.fn().mockImplementation(async () => {
      sleepCount += 1;
      if (sleepCount >= 5) controller.abort(); // el abort ocurre tras el último sleep
    });

    const deps = dependencies(controller, { getCupos, sleep });
    const result = await runWatch(target, 300_000, controller.signal, deps);

    expect(result).toBe("stopped");
    expect(getCupos).toHaveBeenCalledTimes(5);

    expect(deps.notifier.notify).toHaveBeenCalledOnce();
    expect(deps.notifier.notify).toHaveBeenCalledWith({
      target,
      slots: [expect.objectContaining({ fechaCitaProg: "05/09/2026", nroCupo: 5 })],
    });

    expect(deps.saveState).toHaveBeenCalledTimes(4);

    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("Reintentando"));
  });
});
