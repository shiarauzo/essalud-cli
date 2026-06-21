# essalud-cli

CLI no oficial para reservar y cancelar citas de EsSalud desde la terminal.

## Requisitos

- Node >= 20
- pnpm

## Instalar como comando global `essalud`

Hacer esto una sola vez:

```bash
pnpm install
pnpm build
pnpm link --global
```

Despues de eso, en cualquier carpeta:

```bash
essalud          # abre el modo interactivo (menu navegable)
essalud perfil   # subcomando one-shot
essalud citas
essalud login --token <jwt>
```

## Modo interactivo

Correr `essalud` sin argumentos abre un menu navegable (tipo command palette):

```
┌  essalud · asistente de citas EsSalud
│
│  Estado: logueado · expira 21/6/2026, 1:53 a. m.
│
◆  ¿Que queres hacer?
│  ● Login
│  ○ Mi perfil
│  ○ Mis citas
│  ○ Reservar una cita
│  ○ Cancelar una cita
│  ○ Salir
│  ↑/↓ to navigate · Enter: confirm
```

El flujo "Reservar una cita" es guiado: especialidad → actividad → cupo disponible → resumen → confirmacion explicita antes del POST real.

## Subcomandos one-shot

| Comando | Que hace |
|---|---|
| `essalud token` | Muestra si hay token y si esta vigente |
| `essalud perfil` | Datos del asegurado (GET /perfil) |
| `essalud citas` | Citas emitidas (POST /citasEmitidas) |
| `essalud login` | Login asistido (abre browser headed + captura token) |
| `essalud login --token <jwt>` | Guardar token manualmente |
| `essalud login --from-har <path>` | Importar token desde HAR de DevTools |
| `essalud especialidades <codCentro>` | Lista especialidades del centro |
| `essalud fechas <codCentro> <codServicioHosp> <codActSubAct>` | Cupos disponibles |
| `essalud reservar` | Reservar cita (requiere --confirm para el POST real) |
| `essalud cancelar <citActMedNum>` | Cancelar cita (requiere --confirm) |

## Desarrollo

```bash
# Sin build (tsx)
pnpm dev <subcomando>

# Con build
pnpm build
node dist/essalud-bin.js              # modo interactivo directo
node dist/essalud-bin.js <subcomando> # subcomando one-shot
```

## Token

El token JWT se lee de `~/.tramites-pe/essalud/token` (chmod 600).

Para obtenerlo: `essalud login` o pegar manualmente con `essalud login --token <jwt>`.

**El token nunca sale de tu maquina.**

## Estructura

```
src/
  essalud-bin.ts            # entry point del comando global `essalud`
  essalud/
    api.ts                  # cliente HTTP + tipos de dominio
    interactive.ts          # modo interactivo (@clack/prompts)
    cmd-token.ts            # essalud token
    cmd-perfil.ts           # essalud perfil
    cmd-citas.ts            # essalud citas
    cmd-login.ts            # essalud login (asistido + --token + --from-har)
    cmd-especialidades.ts   # essalud especialidades
    cmd-fechas.ts           # essalud fechas
    cmd-reservar.ts         # essalud reservar
    cmd-cancelar.ts         # essalud cancelar
    index.ts                # router de subcomandos essalud
```

## Notas

- Base URL: `https://api.miconsulta.essalud.gob.pe/api`
- El captcha de Cloudflare (Turnstile) esta solo en el login; las llamadas a la API no lo requieren.
- `essalud reservar` y el flujo interactivo de reserva siempre piden confirmacion explicita antes de hacer el POST real a /generarCita.
