# essalud-cli

CLI **no oficial** para reservar y cancelar citas de EsSalud desde la terminal.

> ⚠️ **Disclaimer.** Proyecto independiente, **no afiliado a EsSalud**. Usa la API
> pública de su portal de citas mediante ingeniería inversa, así que puede dejar de
> funcionar si EsSalud cambia su backend. Usalo bajo tu responsabilidad.
> Las credenciales se guardan localmente con permisos `600` y el CLI solo las envía
> a la API HTTPS de EsSalud para autenticar tus solicitudes.

## Requisitos

- Node >= 20
- Solo para el login asistido: un navegador Chromium. El CLI usa el que ya tengas
  instalado (Brave, Chrome, Edge) y, si no encuentra ninguno, el de Playwright:
  ```bash
  npx playwright install chromium
  ```
  No hace falta para `--from-har`, `--token` ni `--renovar`.

## Instalación

```bash
npm install -g essalud-cli
```

Después, en cualquier carpeta:

```bash
essalud          # modo interactivo (menú navegable)
essalud login    # inicia sesión (ver "Login": lo más confiable es --from-har)
essalud perfil   # subcomando one-shot
essalud citas
```

## Login

El login de EsSalud está protegido con Cloudflare Turnstile, que **rechaza los
navegadores automatizados**. Por eso el camino más confiable es importar la sesión
desde un HAR de tu navegador normal:

```bash
essalud login --from-har ~/Downloads/captura.har
```

Para capturar ese HAR:

1. Abre <https://digital.essalud.gob.pe/login> **sin loguearte todavía**.
2. DevTools (F12) → **Network** → marca **Preserve log** y limpia la lista.
3. Ahora sí loguéate y entra a tus citas.
4. Click derecho en la lista → **Save all as HAR with content**.

El CLI saca del body de `/api/lg` el access token **y el refresh token**, guarda tus
datos de paciente y valida la sesión contra `/perfil`. El HAR contiene tu token: bórralo
después de importarlo.

### Renovación: no repites esto cada día

El access token dura 24 h, y el refresh token vence junto con él — pero cada renovación
emite un par nuevo con 24 h frescas. El CLI renueva **solo**: si una request falla por
token vencido, llama a `/retoken`, guarda el par nuevo y reintenta. Mientras uses el CLI
al menos una vez cada 24 h, no vuelves a pasar por el navegador ni el captcha.

Para renovar a mano:

```bash
essalud login --renovar
```

### Otros caminos

```bash
# Login asistido: abre un navegador real del sistema (Brave/Chrome/Edge), perfil
# limpio y efímero. Puede fallar por Turnstile aunque tu clave esté bien.
essalud login

# Pegar el token a mano (queda sin refresh token: al vencer, login de nuevo).
# Está en DevTools → Network → request 'lg' → Response → data.credenciales.access_token
essalud login --token <jwt>
```

> El portal migró de `miconsulta.essalud.gob.pe` a `digital.essalud.gob.pe`; la API sigue
> en `api.miconsulta.essalud.gob.pe`. El portal nuevo autentica sus propias llamadas con
> una cabecera `x-device-id` y no manda `Authorization`, así que el token del CLI solo
> aparece en el body del login: por eso el HAR tiene que incluir el `/api/lg`.

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
| `essalud watch <codCentro> <codServicioHosp> <codActSubAct>` | Avisa cuando aparecen cupos nuevos |
| `essalud reservar` | Reservar cita (requiere `--confirm` para el POST real) |
| `essalud cancelar <citActMedNum>` | Cancelar cita (requiere `--confirm`) |

## Monitorear cupos

`watch` consulta periódicamente la misma programación que `fechas` y avisa cuando
aparece un cupo que no estaba en la consulta anterior:

```bash
essalud watch 021 F11 B1010
essalud watch 021 F11 B1010 --interval 10m --notify desktop
```

- El intervalo por defecto es `5m` y el mínimo permitido es `2m`.
- La primera consulta crea el estado inicial y no envía alertas.
- El estado de cada búsqueda se guarda por separado en `~/.essalud/watch/`.
- `terminal` muestra una alerta y una campana; `desktop` usa las notificaciones
  del sistema y cae a terminal si no están disponibles.
- El comando es de solo lectura: nunca reserva ni cancela automáticamente.
- Presiona `Ctrl+C` para detenerlo.

## Credenciales

El access token se guarda en `~/.essalud/token` y, cuando está disponible, el refresh
token en `~/.essalud/refresh_token`. Ambos archivos usan permisos `600`.

El CLI envía el access token únicamente a la API HTTPS de EsSalud como credencial de
autenticación. Para renovar una sesión, envía el refresh token al endpoint HTTPS
`/retoken` de esa misma API.

Para obtenerlos: `essalud login`, o manualmente con `essalud login --token <jwt>`
(este último método no guarda un refresh token).

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
    cmd-watch.ts            # essalud watch
    watch.ts                # normalización y detección de cupos nuevos
    watch-state.ts          # estados persistentes por búsqueda
    watch-notifier.ts       # alertas de terminal y escritorio
    cmd-reservar.ts         # essalud reservar
    cmd-cancelar.ts         # essalud cancelar
    index.ts                # router de subcomandos essalud
```

## Notas

- Base URL: `https://api.miconsulta.essalud.gob.pe/api`
- El captcha de Cloudflare (Turnstile) está solo en el login; las llamadas a la API no lo requieren.
- `essalud reservar` y el flujo interactivo de reserva siempre piden confirmación explícita antes de hacer el POST real a `/generarCita`.

## Licencia

[PolyForm Noncommercial 1.0.0](./LICENSE). El código está a la vista y puedes usarlo,
modificarlo y compartirlo **para fines no comerciales** (personal, educativo, ONG).
Cualquier **uso comercial** requiere permiso de la autora. No es una licencia OSI
"open source" en sentido estricto, sino *source-available* / no comercial.
