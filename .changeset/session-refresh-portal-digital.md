---
"essalud-cli": minor
---

Sesión que se renueva sola y soporte para el portal nuevo (`digital.essalud.gob.pe`).

EsSalud migró el portal de citas y cambió cómo viaja la sesión: sus propias llamadas
autentican con una cabecera `x-device-id` y no mandan `Authorization`, así que el token
del CLI solo aparece en el body de `/api/lg`. Con el token vencido, la API responde 403.

- El login ahora guarda el **refresh token** además del access token (`~/.essalud/refresh_token`, permisos 600).
- Cuando una request falla por token vencido, el CLI llama a `POST /retoken`, guarda el par
  nuevo y reintenta. Como cada renovación emite 24 h frescas, usar el CLI una vez al día
  mantiene la sesión viva sin navegador ni captcha.
- Nuevo `essalud login --renovar` para renovar a mano.
- `--from-har` extrae el par completo del `/api/lg` del HAR (antes solo sacaba el access token).
- El login asistido apunta al dominio nuevo y usa un navegador real del sistema
  (Brave/Chrome/Edge) en vez del Chromium de Playwright, que Turnstile rechaza.
- Arreglado el parseo del paciente: el portal renombró los campos (`priNombre`/`segNombre`
  en vez de `nombres`, `numCelular` en vez de `nroCelular`), por eso el nombre salía
  incompleto y el celular vacío.
- `essalud login` ya no dice "(sin nombre en perfil)": `/perfil` dejó de devolver el nombre,
  ahora se toma del paciente guardado.
