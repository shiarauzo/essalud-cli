import { Command } from "commander";
import { type CancelarOptions, cmdCancelar } from "./cmd-cancelar.js";
import { cmdCitas } from "./cmd-citas.js";
import { cmdEspecialidades } from "./cmd-especialidades.js";
import { cmdFechas } from "./cmd-fechas.js";
import { cmdLogin, type LoginOptions } from "./cmd-login.js";
import { cmdPerfil } from "./cmd-perfil.js";
import { cmdReservar, type ReservarOptions } from "./cmd-reservar.js";
import { cmdToken } from "./cmd-token.js";
import { cmdWatch } from "./cmd-watch.js";
import { runInteractiveMode } from "./interactive.js";

export function makeEssaludCommand(): Command {
  const essalud = new Command("essalud")
    .description("Trámites de EsSalud (citas, perfil, etc.)")
    // Si no se pasa ningún subcomando, lanzar el modo interactivo
    .action(() => {
      void runInteractiveMode();
    });

  essalud.command("perfil").description("Muestra los datos del asegurado").action(cmdPerfil);

  essalud.command("citas").description("Lista las citas emitidas").action(cmdCitas);

  essalud
    .command("token")
    .description("Verifica si hay token guardado y si está vigente")
    .action(cmdToken);

  essalud
    .command("login")
    .description("Login asistido: abre browser headed, captura la sesión de EsSalud y la guarda.")
    .option("--token <jwt>", "Pegar el JWT directamente (sin abrir browser)")
    .option("--from-har <path>", "Importar la sesión desde un HAR exportado de DevTools")
    .option("--renovar", "Renovar con el refresh token guardado (sin browser ni captcha)")
    .action((opts: { token?: string; fromHar?: string; renovar?: boolean }) => {
      const loginOpts: LoginOptions = {
        token: opts.token,
        fromHar: opts.fromHar,
        renovar: opts.renovar,
      };
      return cmdLogin(loginOpts);
    });

  essalud
    .command("especialidades <codCentro>")
    .description(
      "Lista especialidades y actividades disponibles para un centro (POST /parametroSolicitud).",
    )
    .action((codCentro: string) => cmdEspecialidades(codCentro));

  essalud
    .command("fechas <codCentro> <codServicioHosp> <codActSubAct>")
    .description(
      "Muestra cupos y slots disponibles para una especialidad/actividad (POST /programacionDisponible).",
    )
    .action((codCentro: string, codServicioHosp: string, codActSubAct: string) =>
      cmdFechas(codCentro, codServicioHosp, codActSubAct),
    );

  essalud
    .command("watch <codCentro> <codServicioHosp> <codActSubAct>")
    .description("Monitorea cupos nuevos periódicamente (solo lectura).")
    .option("--interval <duracion>", "Intervalo entre consultas (mínimo 2m)")
    .option("--notify <modo>", "Notificación terminal o desktop", "terminal")
    .action(
      (
        codCentro: string,
        codServicioHosp: string,
        codActSubAct: string,
        opts: { interval?: string; notify?: string },
      ) =>
        cmdWatch(codCentro, codServicioHosp, codActSubAct, {
          interval: opts.interval,
          notify: opts.notify,
        }),
    );

  essalud
    .command("reservar")
    .description(
      "Reserva una cita. Dry-run por defecto. Requiere --confirm para el POST real a /generarCita.",
    )
    .option("--cupo-json <json>", "JSON del cupo completo (de la salida de 'fechas')")
    .option("--nro-cupo <nro>", "Número de cupo a reservar (de vCupoDisp[].nroCupo)")
    .option("--hora-slot <hora>", "Hora del slot elegido (solo para mostrar en el resumen)")
    .option("--cod-prog-asis <cod>", "codProgAsis del cupo (alternativa a --cupo-json)")
    .option("--consultorio <cod>", "Consultorio (alternativa a --cupo-json)")
    .option("--fecha <fecha>", "fechaCitaProg del cupo (alternativa a --cupo-json)")
    .option("--turno-ini <hora>", "turnoIni (alternativa a --cupo-json)")
    .option("--turno-fin <hora>", "turnoFin (alternativa a --cupo-json)")
    .option("--celular <nro>", "Número de celular (por defecto del perfil)")
    .option("--email <email>", "Email (por defecto del perfil)")
    .option("--confirm", "Ejecutar la reserva real (requiere confirmación interactiva)")
    .action(
      (opts: {
        cupoJson?: string;
        nroCupo?: string;
        horaSlot?: string;
        codProgAsis?: string;
        consultorio?: string;
        fecha?: string;
        turnoIni?: string;
        turnoFin?: string;
        celular?: string;
        email?: string;
        confirm?: boolean;
      }) => {
        const reservarOpts: ReservarOptions = {
          cupoJson: opts.cupoJson,
          nroCupo: opts.nroCupo,
          horaSlot: opts.horaSlot,
          codProgAsis: opts.codProgAsis,
          consultorio: opts.consultorio,
          fecha: opts.fecha,
          turnoIni: opts.turnoIni,
          turnoFin: opts.turnoFin,
          celular: opts.celular,
          email: opts.email,
          confirm: opts.confirm ?? false,
        };
        return cmdReservar(reservarOpts);
      },
    );

  essalud
    .command("cancelar <citActMedNum>")
    .description("Cancela una cita (POST /eliminarCita). Dry-run por defecto; requiere --confirm.")
    .option(
      "--cod-centro <cod>",
      "Código del centro de la cita (citCenAsiCod), si no aparece en 'citas'",
    )
    .option("--confirm", "Ejecutar la cancelación real (requiere confirmación interactiva)")
    .action((citActMedNum: string, opts: { confirm?: boolean; codCentro?: string }) => {
      const cancelarOpts: CancelarOptions = {
        confirm: opts.confirm ?? false,
        codCentro: opts.codCentro,
      };
      return cmdCancelar(citActMedNum, cancelarOpts);
    });

  return essalud;
}
