import { spawn } from "node:child_process";
import type { WatchSlot, WatchTarget } from "./watch.js";

export type NotifyMode = "terminal" | "desktop";

export interface NewSlotsEvent {
  target: WatchTarget;
  slots: WatchSlot[];
}

export interface Notifier {
  notify(event: NewSlotsEvent): Promise<void>;
  notifySessionExpired(): Promise<void>;
}

export type NativeCommandRunner = (command: string, args: string[]) => Promise<void>;

const MAX_TERMINAL_SLOTS = 10;
const MAX_DESKTOP_SLOTS = 3;

function newSlotsLabel(count: number): string {
  return `${count} ${count === 1 ? "cupo nuevo" : "cupos nuevos"}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function reservationCommand(slot: WatchSlot): string {
  return [
    "essalud reservar",
    `--cod-prog-asis ${shellQuote(slot.codProgAsis)}`,
    `--consultorio ${shellQuote(slot.consultorio)}`,
    `--fecha ${shellQuote(slot.fechaCitaProg)}`,
    `--turno-ini ${shellQuote(slot.turnoIni)}`,
    `--turno-fin ${shellQuote(slot.turnoFin)}`,
    `--nro-cupo ${shellQuote(String(slot.nroCupo))}`,
    `--hora-slot ${shellQuote(slot.hora)}`,
    "--confirm",
  ].join(" ");
}

export function formatNewSlots(event: NewSlotsEvent): string {
  const visible = event.slots.slice(0, MAX_TERMINAL_SLOTS);
  const lines = [
    "",
    `🔔 ${newSlotsLabel(event.slots.length)} en EsSalud`,
    ...visible.map(
      (slot) =>
        `  • ${slot.fechaCitaProg} ${slot.hora} · ${slot.apeNomProf} · consultorio ${slot.consultorio}`,
    ),
  ];

  if (event.slots.length > visible.length) {
    lines.push(`  … y ${event.slots.length - visible.length} más.`);
  }
  if (event.slots[0]) {
    lines.push("", "Para reservar el primero:", `  ${reservationCommand(event.slots[0])}`);
  }
  return lines.join("\n");
}

export class TerminalNotifier implements Notifier {
  constructor(
    private readonly log: (message: string) => void = console.log,
    private readonly bell: () => void = () => process.stderr.write("\u0007"),
  ) {}

  async notify(event: NewSlotsEvent): Promise<void> {
    this.bell();
    this.log(formatNewSlots(event));
  }

  async notifySessionExpired(): Promise<void> {
    this.bell();
    this.log("\n🔒 La sesión de EsSalud venció. Corre `essalud login` para continuar.");
  }
}

export const runNativeCommand: NativeCommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} terminó con código ${code ?? "desconocido"}`));
    });
  });

function desktopCommand(
  platform: NodeJS.Platform,
  title: string,
  body: string,
): { command: string; args: string[] } | null {
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: [
        "-e",
        "on run argv",
        "-e",
        "display notification (item 2 of argv) with title (item 1 of argv)",
        "-e",
        "end run",
        "--",
        title,
        body,
      ],
    };
  }
  if (platform === "linux") {
    return { command: "notify-send", args: [title, body] };
  }
  return null;
}

export class DesktopNotifier implements Notifier {
  private warned = false;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly runCommand: NativeCommandRunner = runNativeCommand,
    private readonly fallback: Notifier = new TerminalNotifier(),
    private readonly log: (message: string) => void = console.log,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  private async useFallback(error: unknown, notify: () => Promise<void>): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      this.warn(`No se pudo mostrar la notificación de escritorio (${String(error)}).`);
      this.warn("Se usarán notificaciones en la terminal.");
    }
    await notify();
  }

  async notify(event: NewSlotsEvent): Promise<void> {
    const title = `EsSalud: ${newSlotsLabel(event.slots.length)}`;
    const visible = event.slots.slice(0, MAX_DESKTOP_SLOTS);
    const body = visible
      .map((slot) => `${slot.fechaCitaProg} ${slot.hora} · ${slot.apeNomProf}`)
      .join("\n");
    const command = desktopCommand(this.platform, title, body);

    try {
      if (!command) throw new Error(`notificaciones no soportadas en ${this.platform}`);
      await this.runCommand(command.command, command.args);
      this.log(formatNewSlots(event));
    } catch (error) {
      await this.useFallback(error, () => this.fallback.notify(event));
    }
  }

  async notifySessionExpired(): Promise<void> {
    const message = "La sesión venció. Corre essalud login para continuar.";
    const command = desktopCommand(this.platform, "EsSalud: sesión vencida", message);

    try {
      if (!command) throw new Error(`notificaciones no soportadas en ${this.platform}`);
      await this.runCommand(command.command, command.args);
      this.log(`\n🔒 ${message}`);
    } catch (error) {
      await this.useFallback(error, () => this.fallback.notifySessionExpired());
    }
  }
}

export function createNotifier(
  mode: NotifyMode,
  platform: NodeJS.Platform = process.platform,
  warn: (message: string) => void = console.warn,
): Notifier {
  if (mode === "terminal") return new TerminalNotifier();
  if (platform !== "darwin" && platform !== "linux") {
    warn(`Las notificaciones de escritorio no están soportadas en ${platform}.`);
    warn("Se usarán notificaciones en la terminal.");
    return new TerminalNotifier();
  }
  return new DesktopNotifier(platform);
}
