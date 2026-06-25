# Implementation Plan: Timezone-Aware Destination ETA with Stop Suggestions

**Branch**: `001-timezone-eta-stops` | **Date**: 2026-06-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-timezone-eta-stops/spec.md`

---

## Summary

Replace the existing custom-duration simulation control with a timezone-aware arrival-time (ETA) feature. The user picks a wall-clock arrival time at the destination; the system auto-detects the destination timezone from its coordinates, computes the required trip duration, and displays an inline stop-suggestion panel when the required moving speed would be unrealistically slow. The old `customDurationS`/`customDurationEnabled` fields and all associated UI/API/engine code are deleted entirely — no deprecation layer. Traffic mode is rewritten to directly reduce `truckSpeedMph` instead of relying on the custom-duration multiplier.

---

## Technical Context

**Language/Version**: TypeScript (strict); Node.js ≥18 on server; React 18 + Vite on frontend

**Primary Dependencies**:
- Backend additions: `tz-lookup` (IANA timezone from lat/lng, ~1 MB, offline)
- Frontend additions: `date-fns-tz` (extends existing `date-fns@^3.6.0`; IANA timezone conversion)
- Frontend existing: `react-day-picker@^9.11.1` (date picker), Radix UI select (time picker)

**Storage**: PostgreSQL via Drizzle ORM — 2 columns removed, 2 columns added on `routes` table

**Testing**: No automated tests. Verification = `pnpm run typecheck` + observed behaviour on running simulation.

**Target Platform**: Node.js server + React SPA served by Vite dev server (port 3000)

**Performance Goals**: Timezone lookup < 5 ms; ETA widget re-renders on endpoint drag should not block map interaction (debounce timezone API call by 400 ms)

**Constraints**: ETA changes must not reset or jump the simulated truck position on a running route

**Scale/Scope**: Single-user route builder; no concurrency concerns for the ETA widget

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Contract-First | PASS | `openapi.yaml` updated before any route implementation |
| II. One Canonical Data Model | PASS | Schema edited in `lib/db/src/schema/routes.ts`; pushed with `db push` |
| III. Type-Check & Verify | PASS | `pnpm run typecheck` required before done; simulation tick observed |
| IV. Complete State, No Dead Scaffolding | PASS | Removed columns have zero remaining consumers after cleanup; new columns drive real multiplier logic |
| V. Simplicity & Honest Surfaces | PASS | ETA widget is admin-only; public page gets ETA for display only; no auth weakening |

---

## Project Structure

### Documentation (this feature)

```text
specs/001-timezone-eta-stops/
├── plan.md              ← this file
├── research.md          ← Phase 0 (complete)
├── data-model.md        ← Phase 1 (complete)
├── contracts/
│   └── api-changes.md  ← Phase 1 (complete)
└── tasks.md             ← Phase 2 (/speckit-tasks command)
```

### Source Code — files that change

```text
lib/
├── db/src/schema/routes.ts                         # remove 2 cols, add 2 cols
├── api-spec/openapi.yaml                           # contract-first changes (see contracts/api-changes.md)
├── api-zod/src/generated/                          # regenerated — do not hand-edit
└── api-client-react/src/generated/                 # regenerated — do not hand-edit

artifacts/api-server/src/
├── lib/
│   ├── simulation-worker.ts                        # replace customDuration multiplier with etaTargetUtc
│   └── simulation-engine.ts                        # verify worker message passing still correct
├── routes/
│   ├── routes.ts                                   # remove customDuration fields; add eta fields
│   └── health.ts                                   # (no change expected)
└── utils/
    └── timezone.ts                                 # NEW: thin wrapper around tz-lookup
    
artifacts/api-server/src/routes/
└── utils.ts                                        # NEW: GET /api/utils/timezone endpoint

artifacts/tracktruck/src/
└── pages/admin/route-builder.tsx                   # major edit: remove custom duration UI, add ETA widget
```

---

## Implementation Phases

### Phase A — Remove Custom Duration (clean slate first)

**Goal**: Delete all custom-duration code so nothing references the removed DB columns during the new build.

1. **DB schema** (`lib/db/src/schema/routes.ts`):
   - Remove `customDurationS` and `customDurationEnabled` columns
   - Add `etaTargetUtc: timestamp("eta_target_utc")` and `etaTimezone: text("eta_timezone")` (both nullable)
   - Run `pnpm --filter @workspace/db run push`

2. **OpenAPI spec** (`lib/api-spec/openapi.yaml`):
   - Remove `customDurationS` from RouteListItem and RouteDetail schemas
   - Remove `customDurationS`/`customDurationEnabled` from PATCH /routes/:id/speed request/response
   - Remove from POST /routes and PUT /routes/:id
   - Add `etaTargetUtc` and `etaTimezone` to RouteDetail, RouteListItem, PATCH /speed request/response
   - Add `etaTargetUtc` and `etaTimezone` to the SimulationSnapshot WebSocket schema
   - Add new `GET /api/utils/timezone` endpoint schema
   - Run codegen: `pnpm --filter @workspace/api-spec run codegen`

3. **Server — routes.ts** (`artifacts/api-server/src/routes/routes.ts`):
   - Remove all `customDurationS`/`customDurationEnabled` references from POST, GET, PUT, PATCH handlers
   - Add `etaTargetUtc` and `etaTimezone` to PATCH /routes/:id/speed: validate `etaTargetUtc` is in the future when non-null; update DB; call `resumeRouteFromCurrentPosition` as before
   - Validate: `etaTimezone` required when `etaTargetUtc` is non-null
   - Include `etaTargetUtc`/`etaTimezone` in GET /routes/:id and list responses

4. **Server — simulation-worker.ts** (`artifacts/api-server/src/lib/simulation-worker.ts`):
   - Remove `customDurationS`/`customDurationEnabled` from the DB select query (lines ~349–361)
   - Add `etaTargetUtc` to the DB select
   - Replace the speed-multiplier calculation:
     ```typescript
     // Old:
     const speedMultiplier = (route.customDurationEnabled && route.customDurationS)
       ? route.estimatedDurationS / route.customDurationS : 1.0;
     // New:
     const speedMultiplier = (route.etaTargetUtc && simState.startedAt)
       ? route.estimatedDurationS / ((route.etaTargetUtc.getTime() - simState.startedAt.getTime()) / 1000)
       : 1.0;
     ```
   - Add `etaTargetUtc`/`etaTimezone` to the snapshot broadcast object

5. **Frontend — route-builder.tsx** (`artifacts/tracktruck/src/pages/admin/route-builder.tsx`):
   - Remove `useCustomDuration` and `customDurationMinutes` state vars
   - Remove custom-duration UI block (lines ~1290–1402)
   - Rewrite traffic mode (lines ~349–396) to use `truckSpeedMph` directly: save previous speed in a `preTrafficSpeedMph` state ref; on enable, PATCH speed to ~20 mph; on disable, PATCH back to saved speed
   - Remove custom-duration initialization from route-load effect (lines ~444–446)

   Typecheck after this phase: `pnpm run typecheck` must pass before Phase B.

---

### Phase B — Add Timezone Utility

**Goal**: Backend can return the IANA timezone for any lat/lng.

1. **Install dependency**: `pnpm --filter @workspace/api-server add tz-lookup`

2. **Create utility** (`artifacts/api-server/src/utils/timezone.ts`):
   ```typescript
   import tzlookup from "tz-lookup";
   import { getTimezoneOffset } from "date-fns-tz"; // or use Intl directly
   
   export function getTimezoneForCoords(lat: number, lng: number): {
     timezone: string;
     label: string;
   } {
     const timezone = tzlookup(lat, lng);
     const now = new Date();
     const fmt = new Intl.DateTimeFormat("en-US", {
       timeZoneName: "long",
       timeZone: timezone,
     });
     const label = fmt.formatToParts(now).find(p => p.type === "timeZoneName")?.value ?? timezone;
     return { timezone, label };
   }
   ```

3. **New route** (`artifacts/api-server/src/routes/utils.ts`): `GET /api/utils/timezone?lat&lng`
   - Validates lat (−90 to 90) and lng (−180 to 180) are present and numeric
   - Returns `{ timezone, label }` using the utility above
   - No auth required (no sensitive data)
   - Register in the main Express app

---

### Phase C — ETA Widget (Frontend)

**Goal**: Replace custom-duration UI with the new ETA widget. Install `date-fns-tz`.

1. **Install dependency**: `pnpm --filter @workspace/tracktruck add date-fns-tz`

2. **New component** `artifacts/tracktruck/src/components/EtaWidget.tsx`:

   **Props**:
   ```typescript
   interface EtaWidgetProps {
     endLat: number | null;
     endLng: number | null;
     distanceM: number;
     estimatedDurationS: number;
     stops: Stop[];                      // existing stops array
     etaTargetUtc: string | null;        // current value from route
     etaTimezone: string | null;
     routeStatus: string;
     onEtaChange: (etaUtc: string | null, timezone: string | null) => void;
   }
   ```

   **Internal logic**:
   - On mount / when `endLat`+`endLng` change: fetch `GET /api/utils/timezone?lat=&lng=` (debounced 400 ms); store `{ timezone, label }` in local state
   - Controlled date + time inputs (use `<input type="date">` + `<input type="time">` or `react-day-picker` + Radix select for time)
   - When either input changes: combine date + time + detected timezone → `zonedTimeToUtc(date, timezone)` from `date-fns-tz` → call `onEtaChange` with the UTC string
   - Compute stop suggestion in a `useMemo`:
     - `existingDwellS = stops.reduce((s, st) => s + st.durationMinutes * 60, 0)`
     - `requiredMovingTimeS = etaDurationS - existingDwellS`
     - `requiredSpeedMph = (distanceM / 1609.34) / (requiredMovingTimeS / 3600)`
     - If `requiredSpeedMph < 10`: compute suggestion (count + dwell per stop + positions)
   - Suggestion panel: shows count, dwell time, and an "Add Suggested Stops" button
   - "Add Suggested Stops" calls `onAddSuggestedStops(suggestedStops)` prop

3. **Wire into route-builder.tsx**:
   - Replace removed custom-duration section with `<EtaWidget … />`
   - `onEtaChange` callback calls `PATCH /routes/:id/speed` with new `etaTargetUtc`/`etaTimezone` (debounced or on blur — match existing speed-update pattern)
   - `onAddSuggestedStops` callback adds stops via `syncStopsToBackend` (existing bulk stop sync function)
   - Read `route.etaTargetUtc` and `route.etaTimezone` from route data on load and set local state

4. **Public tracking page**: Read `etaTargetUtc` and `etaTimezone` from the live snapshot; display "ETA: 3:00 PM MT" when non-null. Use `formatInTimeZone(new Date(etaTargetUtc), etaTimezone, "h:mm a zzz")` from `date-fns-tz`.

---

### Phase D — Verification

1. `pnpm run typecheck` from repo root — must pass with zero errors
2. Start both dev servers: `pnpm --filter @workspace/api-server run dev` + `pnpm --filter @workspace/tracktruck run dev`
3. Create a route with start in Los Angeles area and end in Phoenix area — ETA widget must show "Mountain" timezone
4. Set an ETA 6 hours from now for a short (30-min natural) route — stop suggestion panel must appear with correct math
5. Accept suggested stops — stops must appear in the stops list; warning must disappear
6. Start the route — simulation must run; public page must show "ETA: X:XX PM MT"
7. Edit the ETA while route is in_progress — truck must not jump; new multiplier must apply within one tick
8. Remove the ETA — route must revert to natural speed; public page ETA must disappear
9. Toggle traffic mode — must still work; underlying `truckSpeedMph` must change (not customDuration)

---

## Complexity Tracking

No constitution violations. No new abstractions beyond what's needed.

| Decision | Rationale |
|----------|-----------|
| `tz-lookup` on backend only | Keeps ~1 MB boundary data off the frontend bundle |
| `date-fns-tz` not `luxon` | date-fns already present; avoid duplicating date library |
| ETA stored as UTC timestamp, not pre-computed seconds | Enables correct handling of mid-route ETA edits without recalculation on save |
| Inline stop suggestions (Option A) | Single workflow, no context-switching; stops can be fine-tuned in stops section after acceptance |
| Traffic mode → direct truckSpeedMph | Simpler and more honest than a multiplier hack; same visual behaviour |
