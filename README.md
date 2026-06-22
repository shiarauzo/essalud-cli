# essalud-cli

CLI **no oficial** para reservar y cancelar citas de EsSalud desde la terminal.

> ⚠️ **Disclaimer.** Proyecto independiente, **no afiliado a EsSalud**. Usa la API
> pública de su portal de citas mediante ingeniería inversa, así que puede dejar de
> funcionar si EsSalud cambia su backend. Usalo bajo tu responsabilidad.
> **Tu token y tus datos nunca salen de tu máquina** (se guardan localmente con permisos `600`).

## Requisitos

- Node >= 20
- Un navegador de Playwright (para el login asistido). Se instala una sola vez:
  ```bash
  npx playwright install chromium
  ```
  Si no lo instalás, el login asistido te avisa; igual podés loguearte con `--token` o `--from-har`.

## Instalación

```bash
npm install -g essalud-cli
```

Después, en cualquier carpeta:

```bash
essalud          # modo interactivo (menú navegable)
essalud login    # inicia sesión: abre un navegador aislado y captura el token
essalud perfil   # subcomando one-shot
essalud citas
```

## Login

`essalud login` **abre un navegador nuevo y aislado** (perfil limpio, no toca tu Chrome):

1. Ingresás tu DNI y clave en el navegador.
2. Completás el captcha de Cloudflare Turnstile.
3. Esperás a ver tu panel (lista de citas).

El CLI captura el token automáticamente desde la red, lo valida contra `/perfil` y lo
guarda. La sesión del navegador es efímera: se descarta al terminar.

¿No querés/podés usar el navegador asistido? Hay dos caminos manuales:

```bash
# A) pegar el token a mano (Authorization: Bearer <jwt> desde DevTools → Network)
essalud login --token <jwt>

# B) importar desde un HAR exportado de DevTools
essalud login --from-har ~/Downloads/captura.har
```

## Modo interactivo

Correr `essalud` sin argumentos abre un menú navegable (tipo command palette):

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

El flujo "Reservar una cita" es guiado: especialidad → actividad → cupo disponible → resumen → confirmación explícita antes del POST real.

## Subcomandos one-shot

| Comando | Qué hace |
|---|---|
| `essalud login` | Login asistido (abre navegador aislado + captura token) |
| `essalud login --token <jwt>` | Guardar token manualmente |
| `essalud login --from-har <path>` | Importar token desde HAR de DevTools |
| `essalud token` | Muestra si hay token y si está vigente |
| `essalud perfil` | Datos del asegurado (GET /perfil) |
| `essalud citas` | Citas emitidas (POST /citasEmitidas) |
| `essalud especialidades <codCentro>` | Lista especialidades del centro |
| `essalud fechas <codCentro> <codServicioHosp> <codActSubAct>` | Cupos disponibles |
| `essalud reservar` | Reservar cita (requiere `--confirm` para el POST real) |
| `essalud cancelar <citActMedNum>` | Cancelar cita (requiere `--confirm`) |

## Token

El token JWT se guarda en `~/.essalud/token` (chmod `600`).
Para obtenerlo: `essalud login`, o manualmente con `essalud login --token <jwt>`.

**El token nunca sale de tu máquina.**

## Desarrollo

```bash
# Sin build (tsx)
pnpm install
pnpm dev <subcomando>

# Con build
pnpm build
node dist/essalud-bin.js              # modo interactivo directo
node dist/essalud-bin.js <subcomando> # subcomando one-shot
```

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
    cmd-login.ts            # essalud login (navegador Playwright + --token + --from-har)
    cmd-especialidades.ts   # essalud especialidades
    cmd-fechas.ts           # essalud fechas
    cmd-reservar.ts         # essalud reservar
    cmd-cancelar.ts         # essalud cancelar
    index.ts                # router de subcomandos essalud
```

## Notas

- Base URL: `https://api.miconsulta.essalud.gob.pe/api`
- El captcha de Cloudflare (Turnstile) está solo en el login; las llamadas a la API no lo requieren.
- `essalud reservar` y el flujo interactivo de reserva siempre piden confirmación explícita antes de hacer el POST real a `/generarCita`.

## Licencia

[PolyForm Noncommercial 1.0.0](./LICENSE). El código está a la vista y podés usarlo,
modificarlo y compartirlo **para fines no comerciales** (personal, educativo, ONG).
Cualquier **uso comercial** requiere permiso de la autora. No es una licencia OSI
"open source" en sentido estricto, sino *source-available* / no comercial.
