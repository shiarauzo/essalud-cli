# PLANS · essalud-cli

> Documento vivo. Plan de ejecución del goal de `essalud-cli`.
> Goal de referencia: [`docs/goal.md`](./docs/goal.md).
> Idioma de todo el proyecto: **español peruano** (tuteo, sin voseo).

---

## 1. Purpose / Big Picture

`essalud-cli` es una herramienta de terminal para gestionar citas de EsSalud. La meta de
este plan es llevarla de "funciona en mi máquina" a un proyecto **usable, contribuible y
con código ejemplar**, verificado por agentes propios.

**Beneficio:** sacar/cancelar una cita en segundos desde la terminal, con un proyecto sano
que otros puedan instalar y mejorar.

**Comportamiento visible al terminar:**
- `npm i -g essalud-cli` deja el comando `essalud` listo (publicación queda a un comando).
- `essalud login` abre un navegador aislado y guarda el token solo en `~/.essalud/`.
- El código pasa `biome check`, tiene tests en CI, y un veredicto de calidad **PASS**.

---

## 2. Initial Requirements & Scope

**Capa 1 — Usable**
- Token en `~/.essalud/` (migración limpia desde `~/.tramites-pe/`).
- Login con Playwright funcionando en máquina limpia.
- Flujos reales operativos: perfil, citas, especialidades, fechas, reservar, cancelar.
- Todo el texto del CLI en español peruano.

**Capa 2 — Contribuible**
- Biome (lint + format).
- Vitest unit (funciones puras) como gate de CI en cada PR (con `tsc` + `biome`).
- E2E real auto-limpiante (reservar+cancelar en `try/finally`), manual/agendado, guard `ESSALUD_E2E=1`, token secreto.
- `CONTRIBUTING.md`, templates de issues/PR, `CODE_OF_CONDUCT.md`, Changesets.

**Capa 3 — Código modelo**
- Revisor en **PASS**; sin rutas/nombres heredados, sin docs obsoletas, sin comentarios redundantes.

**Agentes del proyecto**
- `revisor-calidad-essalud` *(ya existe)*, `endpoint-mapper`, `test-writer`, `release-manager`.

**Fuera de scope (no-goals):**
- Publicar (npm publish + repo público) — lo dispara la autora.
- E2E en PRs; tocar `generarCita`/`eliminarCita` fuera del E2E auto-limpiante.
- Multi-cuenta / sesión persistente en login.
- Rediseño de arquitectura.
- i18n / inglés.
- Licencia OSI (es PolyForm Noncommercial 1.0.0).

---

## Modo de trabajo

- Primero **cerrar/mergear los PRs actuales** (#1 revisor, #2 publicable) a `main`.
- Luego **una rama por milestone**, trabajada en **git worktrees** (carpeta aislada por rama) para avanzar sin pisarse y abrir un PR revisable por milestone.
- Cada agente se crea **dentro del milestone donde se usa** (no todos juntos).

## 3. Milestones & Deliverables

### M1 — Español peruano (Usable)
- **Entregables:** todo el texto convertido a tuteo peruano — mensajes del CLI, README, encabezado de `LICENSE`, `docs/goal.md`, `PLANS.md`, agente revisor.
- **Aceptación:** `grep` no encuentra formas de voseo (imperativos con tilde final tipo -á/-é/-í, ni el pronombre rioplatense) en código ni docs.

### M2 — Migración del token a `~/.essalud/` (Usable)
- **Entregables:** `TOKEN_PATH`/`PACIENTE_PATH` apuntan a `~/.essalud/` en `api.ts`; sin fallback al viejo.
- **Aceptación:** `essalud login` escribe en `~/.essalud/`; no queda ninguna referencia a `~/.tramites-pe` en `src/`.

### M3 — Calidad base: Biome (Contribuible)
- **Entregables:** `biome.json`, scripts `lint`/`format`/`check`, código formateado.
- **Aceptación:** `biome check` pasa sin errores sobre `src/`.

### M4 — Tests Vitest unit + E2E auto-limpiante + agente `test-writer` (Contribuible)
- **Entregables:** Vitest configurado; **agente `test-writer`** creado y usado para generar los unit tests de funciones puras; suite E2E real auto-limpiante con guard `ESSALUD_E2E=1`.
- **Aceptación:** `pnpm test` (unit) pasa y es determinista; el `test-writer` produce specs que pasan; una corrida E2E real reserva y cancela sin dejar cita colgada.

### M5 — CI + infra de contribución (Contribuible)
- **Entregables:** GitHub Actions (PR: `tsc`+`biome`+unit; E2E en workflow manual/agendado con secreto); `CONTRIBUTING.md`, templates issues/PR, `CODE_OF_CONDUCT.md`, Changesets.
- **Aceptación:** un PR de prueba dispara el workflow y pasa; el E2E solo corre por `workflow_dispatch`/cron.

### M6 — Agente `endpoint-mapper` (habilitador, standalone)
- **Entregables:** agente `endpoint-mapper` en `.claude/agents/` (HAR → endpoints/payloads/tipos en `api.ts`, **vía rama/PR**).
- **Aceptación:** corre sobre un HAR de muestra y propone un PR con los cambios de `api.ts`; no mergea solo.

### M7 — Código modelo: pasar el revisor (Código modelo)
- **Entregables:** issues del revisor resueltos (incluida la advertencia obsoleta de `cancelar` en `index.ts`).
- **Aceptación:** `revisor-calidad-essalud` corre y su veredicto final es **PASS**.

### M8 — Release listo + agente `release-manager` (línea de meta)
- **Entregables:** **agente `release-manager`** creado; probado en **dry-run**; `npm pack` verificado.
- **Aceptación:** todo a un comando del release real; publicación pendiente de decisión de la autora.

### M9 — Verificación final contra el goal
- **Entregables:** corrida del `project-verifier` contra `docs/goal.md` ("Cómo se ve el éxito" + "Listo cuando").
- **Aceptación:** pass por cada criterio de las 3 capas, con evidencia real.

---

## 4. Progress

**M0 — Cerrar PRs actuales**
- [ ] Mergear PR #1 (revisor) a `main`
- [ ] Mergear PR #2 (publicable: login Playwright + licencia) a `main`

**M1 — Español peruano**
- [ ] Convertir mensajes del CLI a tuteo peruano (`cmd-login.ts` y demás)
- [ ] Convertir README, encabezado de `LICENSE`, `docs/goal.md`, `PLANS.md`, agente revisor
- [ ] `grep` sin voseo en el repo

**M2 — Migración del token**
- [ ] Migrar `TOKEN_PATH`/`PACIENTE_PATH` a `~/.essalud/` en `api.ts`
- [ ] Verificar `essalud login` escribe en `~/.essalud/`; sin referencias a `~/.tramites-pe`

**M3 — Biome**
- [ ] Agregar `biome.json` + scripts
- [ ] `biome check --write` sobre `src/` y commit del formateo

**M4 — Tests + agente test-writer**
- [ ] Configurar Vitest
- [ ] Crear agente `test-writer`
- [ ] Unit: `extractTokenFromHar`, `extractPacienteFromHar`, `decodeJwtPayload`, `looksLikeEsSaludJwt`, unwrap de `request`
- [ ] (Opcional) api.ts con fetch mockeado
- [ ] E2E auto-limpiante con guard `ESSALUD_E2E=1`

**M5 — CI + infra**
- [ ] Workflow CI (PR): `tsc` + `biome` + unit
- [ ] Workflow E2E manual/agendado con secreto del token
- [ ] `CONTRIBUTING.md`
- [ ] Templates de issues y PR en `.github/`
- [ ] `CODE_OF_CONDUCT.md`
- [ ] Changesets configurado

**M6 — Agente endpoint-mapper**
- [ ] Crear `endpoint-mapper` (HAR → api.ts vía PR)
- [ ] Probar contra un HAR de muestra

**M7 — Código modelo**
- [ ] Correr `revisor-calidad-essalud`
- [ ] Resolver issues (incluida advertencia obsoleta de `cancelar`)
- [ ] Veredicto **PASS**

**M8 — Release listo + agente release-manager**
- [ ] Crear `release-manager`
- [ ] `release-manager` en dry-run
- [ ] `npm pack` verificado

**M9 — Verificación final**
- [ ] Correr `project-verifier` contra `docs/goal.md`
- [ ] Pass por criterio con evidencia

---

## 5. Surprises & Discoveries

- **2026-06-21** — `cancelar` ya usa el endpoint confirmado `/eliminarCita` (HAR 2026-06-20) con dry-run + doble confirmación; la advertencia "payload no validado" en `index.ts` quedó **obsoleta** (limpiar en M6).
- **2026-06-21** — Bloqueador de login (ruta hardcodeada a `agent-browser`) ya resuelto con Playwright en el PR #2.
- **2026-06-21** — Nombres `essalud-cli` y `essalud` **libres** en npm.
- **2026-06-21** — Todo el texto previo quedó en voseo argentino; hay que convertir a tuteo peruano (M1).

---

## 6. Decision Log

- **2026-06-21 · Prioridad usable → contribuible → código modelo.** Define cuánto invertir en cada capa y en qué orden.
- **2026-06-21 · Token a `~/.essalud/` sin fallback.** La única sesión existente es la de la autora; re-loguear una vez es trivial y evita deuda.
- **2026-06-21 · Biome** como linter/formatter (una tool, ya familiar en su stack).
- **2026-06-21 · Tests: Vitest unit (gate CI) + E2E real auto-limpiante.** E2E completo incluye reservar/cancelar pero con `try/finally`, manual, guard `ESSALUD_E2E=1`; nunca en PRs (forks no reciben secretos).
- **2026-06-21 · Infra de contribución completa:** CONTRIBUTING + templates + CoC + Changesets.
- **2026-06-21 · 4 agentes del proyecto:** revisor (existe) + endpoint-mapper + test-writer + release-manager. `endpoint-mapper` propone vía PR, no mergea solo.
- **2026-06-21 · Línea de meta = todo listo + release dry-run.** Publicar (npm + repo público) lo decide la autora.
- **2026-06-21 · Idioma: español peruano sin voseo** en todo el proyecto. Ver [[spanish-peruano]].
- **2026-06-21 · Licencia PolyForm Noncommercial 1.0.0** (source-available, sin uso comercial sin permiso).

---

## 7. Outcomes & Retrospectives

_(Se completa al cerrar cada milestone.)_

- **M1:** —
- **M2:** —
- **M3:** —
- **M4:** —
- **M5:** —
- **M6:** —
- **M7:** —

**Qué salió bien / qué mejorar:** —
