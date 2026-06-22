# Contribuir a essalud-cli

¡Gracias por tu interés! Esta guía resume cómo aportar.

> Nota: es un CLI **no oficial** que usa la API de EsSalud por ingeniería inversa.
> Mantén ese espíritu: nada que dañe el servicio ni a otros asegurados.

## Requisitos

- Node ≥ 20
- pnpm
- (Para el login asistido) un navegador de Playwright: `npx playwright install chromium`

## Poner en marcha

```bash
pnpm install
pnpm dev <subcomando>   # corre el CLI sin compilar (tsx)
```

## Antes de abrir un PR

Corre y deja en verde:

```bash
pnpm typecheck   # tipos
pnpm check       # lint + formato (Biome)
pnpm test        # unit tests (Vitest)
```

Si tocaste el formato: `pnpm format` arregla todo automáticamente.

## Estilo y convenciones

- **Idioma:** todo el texto (mensajes del CLI, comentarios, docs, descripciones de tests) en **español peruano** (tuteo: "quieres", "haz", "ingresa"). Sin voseo.
- **Nombres claros** sobre comentarios. Comenta el *porqué*, no el *qué*.
- Imports relativos con extensión `.js` (ESM), como el resto del proyecto.
- Tests junto al código: `src/essalud/<modulo>.test.ts`.

## Tests

- **Unit** (`pnpm test`): funciones puras y lógica con `fetch` mockeado. Sin red real. Son el gate de CI.
- **E2E** (`src/essalud/e2e.test.ts`): flujo real contra EsSalud. Solo corre con `ESSALUD_E2E=1` y un token válido. Es **auto-limpiante** (reserva y cancela en el mismo flujo). No lo conviertas en algo que deje citas reales colgadas.

## Cambios y versionado (changesets)

Si tu cambio afecta a quienes usan el CLI, agrega un changeset:

```bash
pnpm changeset
```

Elige el tipo de versión (patch/minor/major) y describe el cambio en una línea clara.

## Commits y PRs

- Mensajes de commit en presente y al grano (ej. `fix(login): ...`).
- Un PR por tema. Describe el qué y el porqué.
- CI debe pasar (typecheck + Biome + tests).
