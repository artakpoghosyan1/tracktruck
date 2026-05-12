# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Overview

TrackTruck is a **GPS delivery simulation platform**. It has two distinct surfaces:

**Admin dashboard** — used by customers (clients). They build routes on an interactive map (Mapbox), set start/end points and intermediate stops, then activate and start the simulation. A fake truck moves along the route respecting Mapbox-derived speed limits. Controls: pause, resume, speed adjustment. Once a route is activated, a shareable public link is generated.

**Public tracking map** — a zero-auth page (accessed via the share link) showing the live truck position, bearing, route polyline, and stops in real time via WebSocket.

### User roles

| Role | Who | What they can do |
|---|---|---|
| `user` | Customers / clients | Create and manage their own routes; activate up to their quota |
| `admin` | Client-side admins | All of the above + manage users in their org, set payment status and quotas |
| `super_admin` | Us (the platform operators) | Everything + onboard/deactivate clients, manage price tiers and route quotas, set `isPaid` flag |

**Access control is gated via the `allowed_emails` table.** A person cannot sign up or log in unless their email has been pre-added. On signup, if `isPaid = false` the server returns 402. Route activation is blocked when `usedRoutes >= routeLimit`.

The `ROOT_ADMIN_EMAIL` env var designates one email that always gets `super_admin` and bypasses the gate entirely.

### Payment model

No payment processor is integrated. The super-admin manually flips `isPaid` and adjusts `routeLimit` per client in the super-admin dashboard. This is purely an internal CRM-style control.

### Route lifecycle

`draft → ready → in_progress ↔ paused → completed`

Activating a route (`ready`) creates a share link token (valid 7 days). Starting it begins the simulation. The engine ticks every 2 s, interpolates truck position along the polyline using accumulated elapsed time and the speed profile, and broadcasts via WebSocket. When progress hits 100 % the route is marked `completed` and the share link deactivated.

## Commands

```bash
# Install dependencies (pnpm only — npm/yarn are blocked)
pnpm install

# Run the API server (dev, auto-reloads)
pnpm --filter @workspace/api-server run dev

# Run the frontend (dev)
pnpm --filter @workspace/tracktruck run dev

# Typecheck everything (always run from root)
pnpm run typecheck

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client + Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Full build (typecheck + all packages)
pnpm run build
```

There are no tests in this project.

## Architecture

pnpm monorepo. Two artifacts consume shared libs:

```
artifacts/api-server    Express 5 API (auth, routes, simulation, payments, public, WebSocket)
artifacts/tracktruck    React + Vite frontend (admin dashboard, route builder, public tracking)

lib/db                  Drizzle ORM schema + PostgreSQL connection (@workspace/db)
lib/api-spec            OpenAPI 3.1 spec + Orval codegen config
lib/api-zod             Generated Zod request/response schemas (from OpenAPI via Orval)
lib/api-client-react    Generated TanStack Query hooks (from OpenAPI via Orval)
```

**Never hand-edit** `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` — these are produced by `pnpm --filter @workspace/api-spec run codegen` from `lib/api-spec/openapi.yaml`.

## API / Codegen Flow

`lib/api-spec/openapi.yaml` → Orval → two outputs in parallel:
- `lib/api-zod/src/generated/` — Zod schemas used by the server for request validation
- `lib/api-client-react/src/generated/` — React Query hooks used by the frontend

When adding or changing an API endpoint, update `openapi.yaml` first, run codegen, then implement the route and consume the hook.

## Database

Drizzle ORM with PostgreSQL. Schema files live in `lib/db/src/schema/`. The `db` export and all table references come from `@workspace/db`.

Key tables: `users`, `oauth_accounts`, `refresh_tokens`, `allowed_emails`, `routes`, `route_stops`, `route_revisions`, `simulation_states`, `share_links`.

Route lifecycle statuses: `draft → ready → in_progress ↔ paused → completed`.

Schema changes: edit the schema file, then run `pnpm --filter @workspace/db run push`. No migration files are used; schema is pushed directly.

## Auth

- Email/password signup requires the email to be pre-authorized in `allowed_emails` by an admin.
- Google OAuth also requires the email to be in `allowed_emails` (except `ROOT_ADMIN_EMAIL`).
- JWT access + refresh token pair. Access token stored in `localStorage` as `tracktruck_token`.
- Frontend global fetch interceptor (`artifacts/tracktruck/src/lib/api-interceptor.ts`) injects the Bearer token on all `/api` requests and redirects to `/login` on 401.
- `ROOT_ADMIN_EMAIL` env var bypasses `allowed_emails` and always gets `super_admin` role.

## Simulation Engine

Located at `artifacts/api-server/src/lib/simulation-engine.ts`. Runs a `setInterval` (2s ticks) on the server process. Each tick:
1. Queries all `in_progress` routes + their `simulation_states`
2. Computes truck position using `positionAlongPolyline()` in `src/lib/geo.ts`
3. Broadcasts lat/lng/bearing via WebSocket to all connected clients for that route's share token
4. Marks route `completed` and deactivates share links when progress hits 100%

WebSocket channels: `/api/public/ws/track/:token` (unauthenticated) and `/api/admin/ws/routes/:routeId?token=<jwt>` (JWT in query param).

## Environment Variables

| Variable | Where used | Notes |
|---|---|---|
| `DATABASE_URL` | api-server, db | Required; Postgres connection string |
| `JWT_SECRET` | api-server | Falls back to insecure dev default; required in prod |
| `ROOT_ADMIN_EMAIL` | api-server | Super admin bypass email |
| `GOOGLE_CLIENT_ID` | api-server | Enables Google OAuth |
| `VITE_GOOGLE_CLIENT_ID` | frontend | Google Sign-In button |
| `VITE_MAPBOX_TOKEN` | frontend | Mapbox GL maps |
| `VITE_API_URL` | frontend | Backend base URL (empty = same origin) |
| `PORT` | both | Server port (default 8080 / 3000) |
| `BASE_PATH` | frontend | Vite base path (default `/`) |

## TypeScript Project References

Root `tsconfig.json` uses composite project references. Always typecheck from the root (`pnpm run typecheck`), not from individual packages. When a new lib dependency is added between packages, add it to the consuming package's `tsconfig.json` `references` array.