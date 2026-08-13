import { describe, expect, it, vi } from "vitest";
import type { WatchSlot } from "./watch.js";
import {
  createNotifier,
  DesktopNotifier,
  formatNewSlots,
  type NewSlotsEvent,
  reservationCommand,
  TerminalNotifier,
} from "./watch-notifier.js";

function slot(overrides: Partial<WatchSlot> = {}): WatchSlot {
  return {
    key: "slot-1",
    apeNomProf: "Médica Uno",
    codProgAsis: "programacion-1",
    consultorio: "0203",
    fechaCitaProg: "04/09/2026",
    turnoIni: "07:00",
    turnoFin: "13:00",
    hora: "07:00",
    nroCupo: 1,
    ...overrides,
  };
}

function event(slots = [slot()]): NewSlotsEvent {
  return {
    target: { codCentro: "021", codServicioHosp: "F11", codActSubAct: "B1010" },
    slots,
  };
}

describe("notificaciones de terminal", () => {
  it("incluye el detalle y un comando de reserva utilizable", async () => {
    const log = vi.fn();
    const bell = vi.fn();
    const notifier = new TerminalNotifier(log, bell);

    await notifier.notify(event());

    expect(bell).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("04/09/2026 07:00"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("essalud reservar"));
    expect(reservationCommand(slot())).toContain("--confirm");
  });

  it("cita nroCupo aunque un valor malicioso eluda la normalización", () => {
    const command = reservationCommand(
      slot({ nroCupo: "1; touch /tmp/pwned" as unknown as number }),
    );

    expect(command).toContain("--nro-cupo '1; touch /tmp/pwned'");
    expect(command).not.toContain("--nro-cupo 1; touch");
  });

  it("limita el detalle cuando aparecen muchos cupos", () => {
    const slots = Array.from({ length: 12 }, (_, index) =>
      slot({ key: `slot-${index}`, nroCupo: index + 1 }),
    );
    expect(formatNewSlots(event(slots))).toContain("… y 2 más.");
  });
});

describe("notificaciones de escritorio", () => {
  it("usa osascript en macOS sin interpolar datos en el script", async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const notifier = new DesktopNotifier(
      "darwin",
      runCommand,
      new TerminalNotifier(),
      log,
      vi.fn(),
    );

    await notifier.notify(event());

    expect(runCommand).toHaveBeenCalledWith(
      "osascript",
      expect.arrayContaining(["--", "EsSalud: 1 cupo nuevo"]),
    );
    expect(log).toHaveBeenCalledOnce();
  });

  it("cae a terminal y avisa una sola vez cuando desktop falla", async () => {
    const fallback = {
      notify: vi.fn().mockResolvedValue(undefined),
      notifySessionExpired: vi.fn().mockResolvedValue(undefined),
    };
    const warn = vi.fn();
    const notifier = new DesktopNotifier("win32", vi.fn(), fallback, vi.fn(), warn);

    await notifier.notify(event());
    await notifier.notify(event());

    expect(fallback.notify).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("avisa al inicio y usa terminal en plataformas no soportadas", () => {
    const warn = vi.fn();

    expect(createNotifier("desktop", "win32", warn)).toBeInstanceOf(TerminalNotifier);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("win32"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("terminal"));
  });

  it("notifica la expiración de la sesión", async () => {
    const log = vi.fn();
    const bell = vi.fn();
    await new TerminalNotifier(log, bell).notifySessionExpired();

    expect(bell).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("essalud login"));
  });
});
