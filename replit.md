# TrackTruck Live

## Overview

TrackTruck Live is a truck route tracking application. Admins create routes on a map, activate them via payment, start simulations, and share public links where viewers watch the truck move in real-time.

Built as a pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Mapbox GL JS
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for server), Vite (frontend)
- **State management**: Zustand
- **Routing**: wouter
- **Data fetching**: TanStack Query (React Query)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (auth, routes, payments, simulation, public)
│   └── tracktruck/         # React + Vite frontend (admin dashboard, public tracking)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

Tables defined in `lib/db/src/schema/`:
- `users` - Admin user accounts (email, password_hash, name)
- `oauth_accounts` - OAuth provider links (Google)
- `routes` - Truck routes (name, coordinates, polyline, status, speed)
- `route_stops` - Stops along a route (lat/lng, duration, sort order)
- `route_revisions` - History of route edits during simulation
- `simulation_states` - Active simulation state (start time, elapsed, progress)
- `share_links` - Public share tokens for active routes
- `payment_orders` - Payment records (amount, currency, status, provider data)

Route statuses: draft, ready, in_progress, paused, completed, expired
Payment statuses: pending, authorized, paid, failed, expired, refunded

## Schema Sync Status

The database schema is fully in sync with the Drizzle schema definitions.

**Verified 2026-04-11** — `routes.update_count` column confirmed present:

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'routes'
ORDER BY ordinal_position;
-- Result includes: update_count | integer | 0 | NO
```

All columns defined in `lib/db/src/schema/routes.ts` exist in the database, including `update_count` (integer, NOT NULL, default 0). After restarting the API server workflow, logs show clean startup:

```
Starting simulation engine...
Server listening on port 8080
```

No `column routes.update_count does not exist` errors appear in API server logs. Simulation tick cycles run without errors.

## Implementation Status

All features are **fully implemented**:
- ✅ Auth: JWT signup, login, refresh, logout, /me endpoint
- ✅ Routes CRUD: create, list (paginated/searchable/filterable), get, update, soft-delete
- ✅ Stops CRUD: create, update, delete nested under routes
- ✅ Payment flow: mock auto-paid payment, creates share token, moves route to "ready"
- ✅ Simulation engine: real-time truck position along polyline via setInterval (2s ticks), WebSocket broadcast
- ✅ Simulation controls: activate, start, pause, resume, reset, recalculate
- ✅ Public tracking: `/public/track/:token` REST + WebSocket at `/api/public/ws/track/:token`
- ✅ Admin dashboard with route table, status filter, search, pagination, action buttons
- ✅ Route builder with Mapbox map, drag-and-drop stops, save draft + activate flow
- ✅ Mapbox prompt is dismissable ("Skip for now" button)

## Auth Implementation

- `bcryptjs` for password hashing
- `jsonwebtoken` for JWT (access=15min, refresh=7d)
- JWT secret from `JWT_SECRET` env var (fallback dev secret)
- Auth middleware in `src/middlewares/auth.ts`
- JWT interceptor in frontend `src/lib/api-interceptor.ts` auto-injects Bearer token

## Simulation Engine

Located at `src/lib/simulation-engine.ts`. Ticks every 2 seconds:
1. Queries all `in_progress` routes with their simulation states
2. Calculates elapsed time from `startedAt` + `effectiveElapsedMs`
3. Uses truck speed to compute `distanceTraveledM`
4. Computes lat/lng/bearing via `positionAlongPolyline()` in `src/lib/geo.ts`
5. Broadcasts snapshot to all WebSocket clients for each route's share token
6. When progress reaches 100%: marks route `completed`, deactivates share links

## API Endpoints

All endpoints prefixed with `/api`:

**Auth**: signup, login, Google OAuth, refresh, logout, me
**Routes**: CRUD with pagination/search/filter/sort
**Stops**: CRUD nested under routes
**Simulation**: activate, start, pause, resume, reset, recalculate
**Payments**: create, callback, get status
**Public**: track by token, get state by token

## Frontend Pages

- `/login` - Sign in page
- `/signup` - Registration page
- `/admin` - Dashboard with paginated routes table
- `/admin/routes/new` - Route builder with Mapbox
- `/admin/routes/:id` - Route detail/edit
- `/:token` - Public tracking page (full-screen map)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files during typecheck
- **Project references** — when package A depends on B, A's `tsconfig.json` must list B in `references`

## Root Scripts

- `pnpm run build` — typecheck + build all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/` organized by domain: auth, routes, simulation, payments, public, health.

### `artifacts/tracktruck` (`@workspace/tracktruck`)

React + Vite frontend. Uses shadcn/ui components, Mapbox GL for maps, wouter for routing, Zustand for state.

### `lib/db` (`@workspace/db`)

Drizzle ORM schema + PostgreSQL connection. Push schema: `pnpm --filter @workspace/db run push`

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec + Orval codegen. Run: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` / `lib/api-client-react`

Generated Zod schemas and React Query hooks from OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts run via `pnpm --filter @workspace/scripts run <script>`.
