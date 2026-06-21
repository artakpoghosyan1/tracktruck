# Research: Timezone-Aware Destination ETA

## Date/Time Library

**Decision**: `date-fns-tz` (frontend) + Node.js built-in `Intl` API (backend)

**Rationale**: `date-fns@^3.6.0` is already installed in the frontend. `date-fns-tz` is the canonical extension that adds full IANA timezone support to date-fns — same API style, tree-shakeable, no bundle bloat. Converting a wall-clock time (e.g., "3:00 PM America/Phoenix") to a UTC moment and back is a one-liner with `zonedTimeToUtc` / `formatInTimeZone`. No need for luxon or dayjs; those would duplicate what date-fns already provides.

On the backend (Node.js ≥18), `Intl.DateTimeFormat` natively resolves IANA timezone names and offsets — no library needed. DST-safe UTC conversion can be done with a small utility using `Intl.DateTimeFormat`.

**Alternatives considered**:
- `luxon` — first-class timezone support but adds ~70KB and duplicates date-fns
- `dayjs` + timezone plugin — lightweight but adds a third date library alongside date-fns
- `Temporal` polyfill — the future standard; polyfill too large and API still stabilising

---

## Timezone Lookup from Coordinates

**Decision**: `tz-lookup` npm package on the **backend** only; frontend calls a thin API endpoint.

**Rationale**: `tz-lookup` (~1 MB, offline) does point-in-polygon lookup against timezone boundary data and returns the IANA timezone string for a lat/lng in <1 ms. It is a backend-only dependency — keeping timezone boundary data off the frontend bundle (~300–400 KB saved). The frontend calls `GET /api/utils/timezone?lat=X&lng=Y` when the endpoint marker is placed on the map.

**Alternatives considered**:
- `geo-tz` — more accurate but 7 MB of polygon data; overkill for US road routing
- GeoNames API (external) — network round-trip, rate-limited, adds external dependency
- Bundling `tz-lookup` in the frontend — ~1 MB uncompressed is acceptable but unnecessary since the backend already has the coordinates

---

## Custom Duration Feature Removal Scope

All of the following are removed in full (no deprecation or feature-flag):

| Layer | What's removed |
|-------|---------------|
| DB schema | `routes.customDurationS` (doublePrecision), `routes.customDurationEnabled` (boolean) |
| Simulation worker | `speedMultiplier` derived from `customDurationEnabled`/`customDurationS` (lines 353–354, 382–383 in simulation-worker.ts) |
| API routes | `customDurationS`, `customDurationEnabled` fields from POST /routes, GET /routes/:id, PUT /routes/:id, PATCH /routes/:id/speed |
| OpenAPI spec | `customDurationS` from RouteListItem and RouteDetail schemas |
| Frontend state | `useCustomDuration`, `customDurationMinutes` state vars in route-builder.tsx |
| Frontend UI | Custom simulation time checkbox + input + Update/Reset buttons (lines 1290–1402) |
| Traffic mode | Rewritten to use direct `truckSpeedMph` reduction instead of customDuration hack (lines 349–396) |

---

## Traffic Mode Without Custom Duration

**Decision**: Traffic mode sets `truckSpeedMph` directly to the traffic speed (~20 mph) and back.

**Rationale**: Traffic mode currently encodes a traffic speed as a custom duration multiplier, which is an indirect hack. Without customDuration, the cleaner equivalent is toggling `truckSpeedMph` between the normal speed and a traffic speed (~20 mph). The visual result on the simulation is identical. The PATCH /routes/:id/speed endpoint already handles `truckSpeedMph` changes.

---

## Stop Suggestion UX

**Decision**: Inline acceptance — suggested stops are presented and accepted directly inside the ETA widget.

**Rationale**: The user sets ETA → sees an immediate warning → clicks "Add Suggested Stops" → stops are created and appear in the stops list. No context-switching. The suggestion panel is embedded in the ETA card and disappears once stops are added or the warning is dismissed. Users can then fine-tune stop names/positions/durations in the stops section.

**Stop suggestion algorithm**:
1. `naturalMovingTimeS` = `estimatedDurationS` (route duration at normal speed, no stops)
2. `existingDwellS` = sum of all existing stop `durationMinutes × 60`
3. `etaDurationS` = `etaTargetUtc` − `now` (wall clock; updated when ETA changes)
4. `requiredMovingTimeS` = `etaDurationS` − `existingDwellS`
5. `requiredSpeedMph` = `(distanceM / 1609.34) / (requiredMovingTimeS / 3600)`
6. If `requiredSpeedMph < 10` → unrealistic → show suggestion
7. `minMovingTimeS` = `(distanceM / 1609.34) / 10 * 3600` (time at minimum 10 mph)
8. `additionalDwellNeeded` = `etaDurationS` − `existingDwellS` − `minMovingTimeS`
9. `stopCount` = `max(1, ceil(additionalDwellNeeded / 7200))` (max 2 hr per stop)
10. Each stop dwell = `additionalDwellNeeded / stopCount` (rounded to nearest minute)
11. Stop positions: evenly spaced fractions along the polyline, excluding first/last 5%

**Suggestion display**: "To arrive at 3:00 PM MT, add 3 stops (1h 50m each) to maintain realistic movement speed."

---

## ETA and Speed Multiplier in the Simulation Worker

**Decision**: Store `etaTargetUtc` as a UTC timestamp on the route; the worker computes the duration at tick time.

**Rationale**: Storing the UTC target time (not pre-computed seconds) lets the worker correctly handle ETA edits on running routes. At each tick, `etaDurationS = (etaTargetUtc_ms − startedAt_ms) / 1000`. The speed multiplier becomes `estimatedDurationS / etaDurationS` — same formula as before, just sourced from the new field.

When ETA is removed (`etaTargetUtc = null`), `speedMultiplier = 1.0` (normal speed). When ETA is edited on an in-progress route, the worker picks up the new `etaTargetUtc` on the next tick (route data is re-queried or invalidated via worker message, consistent with existing behaviour for speed changes).

**DST handling**: The UTC timestamp is fixed at the moment the user saves the ETA. If a DST boundary is crossed during simulation, the UTC target doesn't change — the simulation continues to the same absolute moment.

---

## ETA Broadcast on Public Page

`etaTargetUtc` and `etaTimezone` are included in the simulation snapshot broadcast and the RouteDetail response so the public tracking page can display "ETA: 3:00 PM MT".

---

## Existing Stop Interaction

Existing stops are factored into the suggestion calculation (`existingDwellS`) before determining whether additional stops are needed. If existing stops already bring `requiredMovingTimeS` into the realistic range, no suggestion is shown.

---

## `updateCount` Exemption

ETA changes (setting, editing, removing) do NOT increment `routes.updateCount`, consistent with the existing rule that speed/timing changes are unlimited. The field is a guard on structural edits (start/end/polyline), not timing.
