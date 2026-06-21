# Goal · essalud-cli

## Goal
`essalud-cli` es una herramienta de terminal que cualquiera puede instalar y usar para gestionar sus citas de EsSalud, está lista para recibir contribuciones de terceros, y su código es claro y ejemplar (naming explícito, sin redundancia), verificado por agentes propios del proyecto.

## Por qué importa
Sacar una cita en EsSalud por el portal es lento y frágil. Un CLI claro y confiable lo vuelve cuestión de segundos. Para que dure y crezca con ayuda de otros, no alcanza con que "funcione": tiene que ser instalable sin fricción, contribuible sin adivinar, y legible para que cualquiera entienda el código sin un tour guiado.

## Cómo se ve el éxito
Tres capas, en orden de prioridad:

**1. Usable (lo primero)**
- `npm install -g essalud-cli` deja el comando `essalud` funcionando.
- `essalud login` abre un navegador aislado (Playwright), la persona se loguea y el token se captura, valida y guarda solo en su máquina.
- El token vive en `~/.essalud/` (nombre coherente con el proyecto).
- Los flujos reales —perfil, citas, especialidades, fechas, reservar, cancelar— funcionan end-to-end.

**2. Contribuible (lo segundo)**
- `biome check` mantiene estilo y atrapa redundancia/imports sin uso.
- **Unit tests (Vitest)** de las funciones puras (parsing de HAR, JWT, desenvoltorio de respuestas) corren como **gate de CI en cada PR** junto a `tsc` y `biome`.
- **E2E real** del flujo completo (incluido reservar+cancelar) existe, pero es **auto-limpiante** (reserva→verifica→cancela en `try/finally`, nunca deja una cita colgada), corre **solo manual/agendado** con guard `ESSALUD_E2E=1` y token secreto — nunca en PRs.
- Hay `CONTRIBUTING.md`, templates de issues y PR, `CODE_OF_CONDUCT.md` y Changesets para versionado/changelog.

**3. Código modelo (lo tercero)**
- El agente `revisor-calidad-essalud` corre y sus hallazgos se resuelven; el veredicto final es **PASS**.
- Sin rutas hardcodeadas, sin nombres heredados ("tramites-pe"), sin comentarios que solo repiten el código, sin docs desactualizadas (ej. la advertencia "payload no validado" de `cancelar`, hoy obsoleta).

**Agentes propios del proyecto (habilitadores de las 3 capas):**
- `revisor-calidad-essalud` *(ya existe)* — audita calidad, abre un issue por hallazgo, da veredicto PASS/FAIL.
- `endpoint-mapper` — toma un HAR nuevo del portal y re-deriva endpoints/payloads/tipos en `api.ts` cuando EsSalud cambia el backend. **Propone los cambios en una rama/PR; nunca mergea a main solo** (el código derivado de un HAR necesita revisión humana).
- `test-writer` — escribe y mantiene los unit tests Vitest de funciones puras (y mocks de fetch).
- `release-manager` — orquesta el release: changeset → bump → build → `npm publish` → tag → GitHub release.

## No-goals
- **No publicar en este goal.** La línea de meta es "todo listo + `release-manager` probado en dry-run"; el `npm publish` y hacer público el repo los dispara la autora cuando quiera.
- **No E2E en PRs.** El flujo real que muta datos nunca corre automáticamente ni en PRs de forks.
- **No tocar `generarCita`/`eliminarCita` fuera del E2E auto-limpiante.** Nada de citas reales colgadas.
- **No multi-cuenta / perfiles persistentes** en el login: la sesión del navegador es aislada y efímera.
- **No reescribir la arquitectura.** Se pule y aclara, no se rediseña.
- **No "open source" OSI.** La licencia es PolyForm Noncommercial 1.0.0 (source-available, sin uso comercial sin permiso).
- **No i18n / inglés.** Todo en español peruano por ahora; nada de soporte multiidioma.

## Restricciones
- Stack: TypeScript ESM, Node ≥20, CLI con `commander` + `@clack/prompts`; login con Playwright.
- Licencia: **PolyForm Noncommercial 1.0.0**.
- Repo único: `shiarauzo/essalud-cli` (privado hasta que la autora decida publicarlo).
- El token y los datos del paciente nunca salen de la máquina del usuario (permisos `600`).
- La API es reverse-engineered: puede cambiar; el diseño debe tolerar re-derivar endpoints (de ahí `endpoint-mapper`).
- Linter/formatter: Biome. Tests: Vitest. CI: GitHub Actions.
- Idioma: **español peruano** (tuteo: "quieres", "tienes", "haz"), **sin voseo argentino**, en todo — CLI, mensajes de error, README, docs e issues.

## Listo cuando
- [ ] El token se lee y escribe en `~/.essalud/` (migración limpia desde `~/.tramites-pe/`).
- [ ] `npm pack` produce un paquete instalable correcto; `npm i -g` del tarball deja `essalud` funcionando.
- [ ] `essalud login` con Playwright funciona en una máquina limpia (con `npx playwright install chromium`).
- [ ] `biome check` pasa sin errores sobre todo `src/`.
- [ ] Unit tests (Vitest) cubren las funciones puras y pasan; corren en CI en cada PR junto a `tsc` + `biome`.
- [ ] Existe el workflow E2E manual/agendado, auto-limpiante y guardado por `ESSALUD_E2E=1`; una corrida real reserva y cancela sin dejar rastro.
- [ ] Están `CONTRIBUTING.md`, templates de issues/PR, `CODE_OF_CONDUCT.md` y Changesets configurado.
- [ ] Existen y funcionan los 4 agentes: `revisor-calidad-essalud`, `endpoint-mapper`, `test-writer`, `release-manager`.
- [ ] El agente revisor corre y su veredicto final es **PASS** (hallazgos resueltos).
- [ ] `release-manager` corre en **dry-run** sin publicar y deja todo a un comando de distancia del release real.
- [ ] Todos los textos visibles (CLI, mensajes de error, README, docs, issues, agentes) están en **español peruano sin voseo**; el texto previo en voseo quedó convertido.
