# TrackTruck Constitution

TrackTruck is a GPS route-simulation and live-tracking platform: an authenticated admin
surface where operators design routes and run a simulated vehicle, and a zero-auth public
surface that renders the simulated position live. This constitution governs how features are
specified, planned, and built. It is the top authority for the spec-driven workflow; every
`/speckit-plan` must pass the Constitution Check below, and any deviation must be justified in
that plan's Complexity Tracking.

## Core Principles

### I. Contract-First (API & Types)

The HTTP surface is defined before it is implemented. `lib/api-spec/openapi.yaml` is the single
source of truth for every endpoint, request, and response.

- Adding or changing an endpoint MUST follow this order: edit `openapi.yaml` → run
  `pnpm --filter @workspace/api-spec run codegen` → implement the server route → consume the
  generated hook on the frontend.
- The generated directories `lib/api-zod/src/generated/` and
  `lib/api-client-react/src/generated/` are NEVER hand-edited. They are outputs, not source.
- Server request validation uses the generated Zod schemas; the frontend calls the generated
  TanStack Query hooks. Bypassing either (ad-hoc fetches, inline validation that duplicates the
  spec) is a violation unless explicitly justified.

*Rationale:* The spec is the contract between server and client. One source, two generated
consumers, zero drift.

### II. One Canonical Data Model

The Drizzle schema in `lib/db/src/schema/` is the canonical data model, imported only via
`@workspace/db`. There is no second source of truth for tables, columns, or status enums.

- Schema changes are applied with `pnpm --filter @workspace/db run push`. No migration files are
  authored or expected.
- All table/enum references in server code come from `@workspace/db`; no redefining shapes
  locally.
- A spec that introduces new persisted state declares the schema change explicitly in its plan.

*Rationale:* A single, pushed schema keeps the model honest and removes ambiguity about where
"the truth" lives.

### III. Type-Check & Verify Before Done (NON-NEGOTIABLE)

This project has no automated test suite. The safety net is the type system plus real,
observed behavior — so both are mandatory gates, not optional steps.

- `pnpm run typecheck` (run from the repo root, never per-package) MUST pass before any change
  is considered complete. Composite project references are kept correct; a new cross-package
  dependency is added to the consuming package's `tsconfig.json` `references`.
- Every change MUST be verified by exercising the affected surface (API endpoint, frontend
  flow, or a running simulation tick) and observing the result. "Compiles" is not "works."
- Completion is reported with evidence (what was run, what was seen), never as a bare assertion.
- Introducing automated tests for new logic is encouraged and never blocked; if a future spec
  adopts test-first development, this principle is amended to require it.

*Rationale:* Without tests, unverified "done" is just a guess. Typecheck + observation is the
minimum bar.

### IV. Complete State, No Dead Scaffolding

Every persisted field, status value, and table either drives real behavior or does not exist.
Half-wired state is a defect, not a placeholder.

- A new column / status / table is shipped together with the code that reads and acts on it. If
  it cannot be fully wired in one change, the spec MUST record it as explicitly deferred (and
  say where the gap is) rather than leaving it silently inert.
- Lifecycle transitions are complete: any status a record can reach has defined entry and exit
  behavior, including what each surface (admin and public) shows in that state.
- Known intent-vs-implementation gaps are documented in `CLAUDE.md`, not left to be rediscovered.
  (At ratification, the live examples are: `share_links.expiresAt` is set but unenforced, the
  `expired` route status is never assigned, and `route_revisions` is unused — these are the
  canonical anti-pattern this principle exists to prevent.)

*Rationale:* Data that implies behavior the code never performs misleads every future reader
and every agent working from the schema.

### V. Simplicity & Honest Surfaces

Build the smallest thing that satisfies the spec, and keep the two product surfaces truthful and
cleanly separated.

- YAGNI: no speculative abstraction, no config knobs without a current consumer.
- The public surface is zero-auth and must never leak privileged data or admin-only controls;
  the admin surface is the only place authenticated actions live.
- Public-facing states tell the truth about what they represent: a simulation presents as a
  simulation, and `completed` / inactive / invalid-link states render accurate, unambiguous
  screens.
- Tooling is pnpm only; `npm`/`yarn` are blocked and never reintroduced.

*Rationale:* A zero-auth surface and a simulation engine are both easy to make subtly
misleading or over-built; this principle keeps them minimal and honest.

## Technology & Tooling Constraints

- **Monorepo:** pnpm workspace. Artifacts (`artifacts/api-server`, `artifacts/tracktruck`)
  consume shared libs (`lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`).
- **Stack:** Express 5 API; React + Vite frontend; Drizzle ORM + PostgreSQL; Mapbox GL; Orval
  for codegen; JWT (access + refresh) auth; WebSocket for live simulation broadcast.
- **Simulation:** the tick loop runs in a Node worker thread spawned by
  `simulation-engine.ts`; `simulation-worker.ts` holds the loop. Changes here are verified
  against a running tick, not just by reading code.
- **Configuration & secrets:** all secrets come from environment variables (`DATABASE_URL`,
  `JWT_SECRET`, `ROOT_ADMIN_EMAIL`, OAuth and Mapbox tokens, etc.). Secrets are never committed.
  `JWT_SECRET` MUST be set in production; the insecure dev fallback is dev-only.
- **Access control:** the `allowed_emails` gate, the four-role hierarchy
  (`super_admin` > `admin` > `org_admin` > `user`), and the per-user/org quota rules are
  invariants. Features do not weaken them; changes that touch auth, quota, or any
  `/public/*` endpoint receive extra review.

## Development Workflow & Quality Gates

- **Spec-driven loop:** `/speckit-constitution` → `/speckit-specify` → (`/speckit-clarify`) →
  `/speckit-plan` → (`/speckit-checklist`) → `/speckit-tasks` → (`/speckit-analyze`) →
  `/speckit-implement`. Specs describe WHAT and WHY; plans describe HOW.
- **API changes** follow Principle I's order (spec → codegen → server → hook) without exception.
- **Definition of Done** for any change:
  1. `pnpm run typecheck` passes from root.
  2. The affected surface has been run and the behavior observed (Principle III).
  3. No dead scaffolding introduced (Principle IV); deferred gaps are written down.
  4. `CLAUDE.md` is updated when product behavior, architecture, or a known gap changes.
- **Branching:** feature work happens on a branch (the `main` branch is the integration target);
  commits and pushes happen only when the author asks for them.

## Governance

- This constitution supersedes ad-hoc practice. When guidance conflicts, the order is: explicit
  user instruction → this constitution → `CLAUDE.md` → default tooling behavior.
- Every `/speckit-plan` includes a Constitution Check; a plan that violates a principle either
  changes to comply or records an explicit, justified exception in its Complexity Tracking.
- `CLAUDE.md` is the runtime guidance file for agents and must be kept accurate; this
  constitution is the governing policy. They are complementary, not duplicates.
- **Amendments:** changes to this document are made here with a version bump and date, and a
  one-line note of what changed. Versioning is semantic:
  - **MAJOR** — remove or redefine a principle, or make a governance change that invalidates
    existing plans.
  - **MINOR** — add a principle or a materially new section/rule.
  - **PATCH** — clarify wording without changing intent.

**Version**: 1.0.0 | **Ratified**: 2026-05-31 | **Last Amended**: 2026-05-31
