import { Command } from "commander";
import { cmdPerfil } from "./cmd-perfil.js";
import { cmdCitas } from "./cmd-citas.js";
import { cmdToken } from "./cmd-token.js";
import { cmdLogin, type LoginOptions } from "./cmd-login.js";
import { cmdEspecialidades } from "./cmd-especialidades.js";
import { cmdFechas } from "./cmd-fechas.js";
import { cmdReservar, type ReservarOptions } from "./cmd-reservar.js";
import { cmdCancelar, type CancelarOptions } from "./cmd-cancelar.js";
import { runInteractiveMode } from "./interactive.js";

export function makeEssaludCommand(): Command {
  const essalud = new Command("essalud")
    .description("Trámites de EsSalud (citas, perfil, etc.)")
    // Si no se pasa ningún subcomando, lanzar el modo interactivo
    .action(() => {
      void runInteractiveMode();
    });

  essalud
    .command("perfil")
    .description("Muestra los datos del asegurado")
    .action(cmdPerfil);

  essalud
    .command("citas")
    .description("Lista las citas emitidas")
    .action(cmdCitas);

  essalud
    .command("token")
    .description("Verifica si hay token guardado y si está vigente")
    .action(cmdToken);

  essalud
    .command("login")
    .description(
      "Login asistido: abre browser headed, captura el Bearer token de EsSalud y lo guarda."
    )
    .option("--token <jwt>", "Pegar el JWT directamente (sin abrir browser)")
    .option("--from-har <path>", "Importar token desde un HAR exportado de DevTools")
    .action((opts: { token?: string; fromHar?: string }) => {
      const loginOpts: LoginOptions = {
        token: opts.token,
        fromHar: opts.fromHar,
      };
      return cmdLogin(loginOpts);
    });

  essalud
    .command("especialidades <codCentro>")
    .description(
      "Lista especialidades y actividades disponibles para un centro (POST /parametroSolicitud)."
    )
    .action((codCentro: string) => cmdEspecialidades(codCentro));

  essalud
    .command("fechas <codCentro> <codServicioHosp> <codActSubAct>")
    .description(
      "Muestra cupos y slots disponibles para una especialidad/actividad (POST /programacionDisponible)."
    )
    .action((codCentro: string, codServicioHosp: string, codActSubAct: string) =>
      cmdFechas(codCentro, codServicioHosp, codActSubAct)
    );

  essalud
    .command("reservar")
    .description(
      "Reserva una cita. Dry-run por defecto. Requiere --confirm para el POST real a /generarCita."
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
      }
    );

  essalud
    .command("cancelar <citActMedNum>")
    .description(
      "Cancela una cita (POST /cancelarCita). Dry-run por defecto. " +
        "ADVERTENCIA: payload no validado en HAR — puede necesitar ajuste."
    )
    .option("--confirm", "Ejecutar la cancelación real (requiere confirmación interactiva)")
    .action((citActMedNum: string, opts: { confirm?: boolean }) => {
      const cancelarOpts: CancelarOptions = { confirm: opts.confirm ?? false };
      return cmdCancelar(citActMedNum, cancelarOpts);
    });

  return essalud;
}
