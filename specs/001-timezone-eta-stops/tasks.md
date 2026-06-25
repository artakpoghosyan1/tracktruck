# Tasks: Timezone-Aware Destination ETA with Stop Suggestions

**Input**: Design documents from `specs/001-timezone-eta-stops/`

**Prerequisites**: plan.md ✓ spec.md ✓ research.md ✓ data-model.md ✓ contracts/ ✓

**Organization**: Tasks grouped by user story to enable independent delivery of each increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1–US4)

---

## Phase 1: Setup (Install Dependencies)

**Purpose**: Add the two new packages required by this feature.

- [X] T001 [P] Install `tz-lookup` on api-server: `pnpm --filter @workspace/api-server add tz-lookup`
- [X] T002 [P] Install `date-fns-tz` on frontend: `pnpm --filter @workspace/tracktruck add date-fns-tz`

---

## Phase 2: Foundational — Remove Custom Duration & Contract Changes

**Purpose**: Delete all custom-duration code and update the contract before any new ETA code is written. This phase MUST complete before any user-story work begins.

**⚠️ CRITICAL**: All user-story phases are blocked on this phase completing.

- [X] T003 Remove `customDurationS` and `customDurationEnabled` columns from routes table; add nullable `etaTargetUtc` (timestamp) and `etaTimezone` (text) columns in `lib/db/src/schema/routes.ts`
- [X] T004 Push schema changes: `pnpm --filter @workspace/db run push`
- [X] T005 Update `lib/api-spec/openapi.yaml`: (a) remove `customDurationS` from RouteListItem, RouteDetail, POST /routes body, PUT /routes/:id body, PATCH /routes/:id/speed request+response; (b) add nullable `etaTargetUtc` (date-time string) and `etaTimezone` (string) to RouteListItem, RouteDetail, and PATCH /speed response; (c) add `etaTargetUtc`+`etaTimezone` to SimulationSnapshot schema; (d) add `GET /api/utils/timezone` endpoint with `TimezoneResponse` schema `{ timezone: string, label: string }`
- [X] T006 Run codegen after OpenAPI changes: `pnpm --filter @workspace/api-spec run codegen`
- [X] T007 Remove all `customDurationS` and `customDurationEnabled` references from POST /routes, GET /routes/:id, list, PUT /routes/:id, and PATCH /routes/:id/speed handlers in `artifacts/api-server/src/routes/routes.ts` — leave ETA fields stubbed as pass-through (stored/returned) but not yet validated
- [X] T008 Remove custom-duration speed-multiplier logic from `artifacts/api-server/src/lib/simulation-worker.ts`: remove `customDurationS`/`customDurationEnabled` from the DB select query (lines ~349–361) and replace the `speedMultiplier` calculation block (lines ~382–383) with `const speedMultiplier = 1.0;` (placeholder — will be replaced in T021)
- [X] T009 Remove custom-duration UI and state from `artifacts/tracktruck/src/pages/admin/route-builder.tsx`: delete `useCustomDuration` and `customDurationMinutes` state vars; delete the custom simulation time UI block (checkbox + input + Update/Reset buttons, lines ~1290–1402); rewrite traffic mode (lines ~349–396) to save `truckSpeedMph` in a `preTrafficSpeedMph` ref and PATCH directly to/from ~20 mph instead of using customDurationS
- [X] T010 Run `pnpm run typecheck` from repo root — must pass with zero errors before proceeding

**Checkpoint**: All custom-duration code deleted; schema + contracts updated; types regenerated; typecheck passes.

---

## Phase 3: User Story 1 — Set Timezone-Aware Arrival Time (Priority: P1) 🎯 MVP

**Goal**: User can place a destination on the map, see its timezone auto-detected, pick an arrival time, and have the route's ETA stored and shown as a computed trip duration.

**Independent Test**: Create a route with start near Los Angeles and end near Phoenix. Set an arrival time 4 hours from now. Verify the widget shows "Mountain" timezone and the computed duration correctly accounts for the PT→MT offset.

- [X] T011 [P] [US1] Create `artifacts/api-server/src/utils/timezone.ts` with a `getTimezoneForCoords(lat, lng)` function using `tz-lookup` that returns `{ timezone: string, label: string }` (use `Intl.DateTimeFormat` with `timeZoneName: "long"` for the label)
- [X] T012 [P] [US1] Create `artifacts/api-server/src/routes/utils.ts` with `GET /api/utils/timezone?lat&lng` — validate lat/lng are present and numeric (400 if not), call `getTimezoneForCoords`, return JSON; register this router in the main app entry point `artifacts/api-server/src/index.ts`
- [X] T013 [US1] Update `PATCH /routes/:id/speed` handler in `artifacts/api-server/src/routes/routes.ts` to accept and store `etaTargetUtc` and `etaTimezone`: validate `etaTargetUtc` is in the future when non-null; require `etaTimezone` when `etaTargetUtc` is set; allow `null` to clear both; do not increment `updateCount`; include `etaTargetUtc`+`etaTimezone` in the success response
- [X] T014 [US1] Include `etaTargetUtc` and `etaTimezone` in GET /routes/:id response and route list response in `artifacts/api-server/src/routes/routes.ts`
- [X] T015 [US1] Create `artifacts/tracktruck/src/components/EtaWidget.tsx` with: (a) props: `endLat`, `endLng`, `distanceM`, `estimatedDurationS`, `stops`, `etaTargetUtc`, `etaTimezone`, `routeStatus`, `liveSnapshot`, `onEtaChange(utc, tz)`; (b) auto-fetch timezone from `GET /api/utils/timezone` on `endLat`/`endLng` change (debounced 400 ms); (c) date + time inputs (use `<input type="date">` + `<input type="time">`) controlled by local state; (d) display detected timezone label; (e) timezone override dropdown listing US IANA timezones (America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles, America/Anchorage, Pacific/Honolulu); (f) on date/time change: convert to UTC using `zonedTimeToUtc` from `date-fns-tz` and call `onEtaChange`; (g) show computed trip duration (ETA UTC − now) below the inputs; (h) "Remove ETA" button that calls `onEtaChange(null, null)`
- [X] T016 [US1] Wire `EtaWidget` into `artifacts/tracktruck/src/pages/admin/route-builder.tsx`: replace the removed custom-duration section with `<EtaWidget />` passing route data and stops; implement `onEtaChange` handler that calls the `PATCH /routes/:id/speed` generated hook (or direct fetch) with the new ETA values; on route load, initialize `etaTargetUtc`/`etaTimezone` local state from the fetched route object; render EtaWidget only when `endLat`+`endLng` are set (endpoint has been placed)

**Checkpoint**: User Story 1 fully functional — timezone auto-detected, ETA stored, duration computed and displayed.

---

## Phase 4: User Story 2 — Realistic Speed Warning & Stop Suggestions (Priority: P1)

**Goal**: When the ETA requires unrealistically slow movement, an inline suggestion panel shows the calculated stop count and dwell time; accepting adds the stops automatically.

**Independent Test**: On a 10-mile route, set ETA to 8 hours from now. Verify the suggestion panel appears showing the correct number of stops and dwell time that would bring the moving speed to ≥10 mph.

- [X] T017 [US2] Add stop-suggestion `useMemo` to `EtaWidget.tsx`: compute `existingDwellS` (sum of `stop.durationMinutes * 60`), `etaDurationS` (ETA UTC − now), `requiredMovingTimeS` (`etaDurationS − existingDwellS`), `requiredSpeedMph` (`(distanceM / 1609.34) / (requiredMovingTimeS / 3600)`); if `requiredSpeedMph < 10` compute: `minMovingTimeS = (distanceM/1609.34)/10*3600`, `additionalDwellNeeded = etaDurationS − existingDwellS − minMovingTimeS`, `stopCount = Math.max(1, Math.ceil(additionalDwellNeeded / 7200))`, `dwellPerStopMin = Math.round(additionalDwellNeeded / stopCount / 60)`; expose as `suggestion: { stopCount, dwellPerStopMin } | null`
- [X] T018 [US2] Implement suggestion panel UI in `EtaWidget.tsx`: when `suggestion` is non-null, show amber warning card with message (e.g. "At this ETA the truck would travel at ~5 mph. Add 3 stops (110 min each) to maintain realistic speed."), "Add Suggested Stops" button, and "Dismiss" button; when dismissed, persist a `isDismissed` local state flag and show a smaller advisory note ("ETA saved — truck will move slower than normal"); hide the full panel when `suggestion` is null
- [X] T019 [US2] Implement "Add Suggested Stops" handler in `EtaWidget.tsx`: compute `stopCount` evenly-spaced polyline positions (fractions 0.1, 0.3, 0.5… capped between 5%–95% of polyline); for each position call `positionAlongPolyline(fraction)` equivalent or interpolate from the `polyline` prop array; create stop objects `{ name: "Stop N", lat, lng, durationMinutes: dwellPerStopMin }`; call `onAddSuggestedStops(stops)` prop; in route-builder.tsx implement `onAddSuggestedStops` to merge with existing stops and call `syncStopsToBackend`
- [X] T020 [US2] Reset `isDismissed` flag in `EtaWidget.tsx` whenever the ETA value changes so a fresh suggestion is shown for each new ETA input

**Checkpoint**: User Story 2 fully functional — unrealistic ETAs surface suggestion panel; accepting suggestion adds correct stops.

---

## Phase 5: User Story 3 — Edit ETA on In-Progress Route (Priority: P2)

**Goal**: ETA can be changed while the route is running; the simulation engine picks up the new value on the next tick without resetting the marker.

**Independent Test**: Start a route, let it run 30 seconds, then change the ETA in the widget. Observe that the public tracking page marker continues smoothly; the speed changes but the position does not jump.

- [X] T021 [US3] Update `artifacts/api-server/src/lib/simulation-worker.ts`: (a) add `etaTargetUtc` to the DB select query; (b) replace the `const speedMultiplier = 1.0;` placeholder with: `const speedMultiplier = (route.etaTargetUtc && simState.startedAt) ? route.estimatedDurationS / ((route.etaTargetUtc.getTime() - simState.startedAt.getTime()) / 1000) : 1.0;`; (c) add `etaTargetUtc: route.etaTargetUtc?.toISOString() ?? null` and `etaTimezone: route.etaTimezone ?? null` fields to the snapshot broadcast object
- [X] T022 [US3] Verify that the existing `resumeRouteFromCurrentPosition` call in `PATCH /routes/:id/speed` (for in-progress routes) is preserved after T013's changes — it should already handle the cache invalidation; if the worker uses a route definition cache, confirm ETA field changes trigger a cache bust (check `simulation-engine.ts` message passing)
- [X] T023 [US3] Update `EtaWidget.tsx` suggestion calculation for in-progress routes: when `routeStatus === "in_progress"` and `liveSnapshot?.distanceTraveledM` is available, compute `remainingDistanceM = distanceM - liveSnapshot.distanceTraveledM` and use it instead of `distanceM` in the suggestion useMemo — so suggestions reflect remaining journey, not total route

**Checkpoint**: User Story 3 complete — ETA editable on live routes with no marker jump; speed adjusts on next tick.

---

## Phase 6: User Story 4 — ETA Display on Public Tracking Page (Priority: P3)

**Goal**: The public tracking page shows "ETA: 3:00 PM MT" when a route has an active ETA.

**Independent Test**: Activate and start a route with an ETA set. Open the public share link. Confirm the ETA is displayed in the destination's timezone with timezone abbreviation.

- [X] T024 [P] [US4] Locate the public tracking page component in `artifacts/tracktruck/src/` (likely `src/pages/public/` or similar) — read the live snapshot subscription to confirm it receives WebSocket messages; verify `etaTargetUtc`+`etaTimezone` are present in the received snapshot type (generated in T006/T021)
- [X] T025 [US4] Add ETA display to the public tracking page: when `snapshot.etaTargetUtc` is non-null, render "ETA: [time] [tz abbrev]" using `formatInTimeZone(new Date(snapshot.etaTargetUtc), snapshot.etaTimezone, "h:mm a zzz")` from `date-fns-tz`; when null, render nothing

**Checkpoint**: User Story 4 complete — public page shows ETA in destination timezone.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T026 Update `CLAUDE.md`: (a) remove the custom-duration description from the Route building & in-flight controls section; (b) add a note about ETA feature — `etaTargetUtc`/`etaTimezone` on routes table, PATCH /speed accepts ETA, simulation worker computes speedMultiplier from ETA; (c) update the description of PATCH /routes/:id/speed to reflect the new fields
- [X] T027 Run `pnpm run typecheck` from repo root — zero errors required
- [ ] T028 Manual verification per plan.md Phase D checklist: start both dev servers; create LA→Phoenix route; set 6-hour ETA on 30-min route; accept stops; start route; check public page; edit ETA while running; remove ETA; toggle traffic mode

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — T001 and T002 run in parallel immediately
- **Phase 2 (Foundational)**: Depends on Phase 1; T003→T004 sequential; T005→T006 sequential; T007/T008/T009 can run in parallel after T006; T010 gates all user story phases
- **Phase 3 (US1)**: Blocked on Phase 2 completion; T011+T012 parallel; T013→T014 sequential; T015→T016 sequential
- **Phase 4 (US2)**: Blocked on Phase 3 (EtaWidget must exist); T017→T018→T019 sequential within EtaWidget; T020 standalone
- **Phase 5 (US3)**: Blocked on Phase 3; T021→T022→T023 sequential
- **Phase 6 (US4)**: Blocked on T021 (snapshot must include ETA fields); T024 parallel, T025 sequential after T024
- **Phase 7 (Polish)**: After all user stories

### Within Phase 2

```
T003 → T004   (schema change → push)
T005 → T006   (openapi edit → codegen)
T007, T008, T009 [parallel after T006]
T010          (typecheck gates exit from phase)
```

### Within Phase 3

```
T011, T012 [parallel]
T013 → T014
T015 → T016
(T011+T012 and T013+T014+T015+T016 can run in parallel tracks)
```

---

## Parallel Execution Examples

### Phase 2 parallel tracks

```
Track A: T003 → T004
Track B: T005 → T006 → T007 / T008 / T009 (parallel)
→ both tracks must finish → T010
```

### Phase 3 parallel tracks

```
Track A: T011 → T012  (backend timezone utility + route)
Track B: T013 → T014  (PATCH /speed + GET /routes ETA fields)
Track C: T015 → T016  (EtaWidget component + wire-up)
→ all three tracks must finish before Phase 4
```

---

## Implementation Strategy

### MVP (User Stories 1 + 2 — both P1)

1. Complete Phase 1 + Phase 2 (foundational cleanup)
2. Complete Phase 3 (US1 — ETA setting)
3. Complete Phase 4 (US2 — stop suggestions)
4. **STOP and validate**: Create a cross-timezone route, set an implausible ETA, accept stop suggestions, verify the simulation runs at realistic speed

### Incremental after MVP

5. Phase 5 (US3): Edit ETA on live route
6. Phase 6 (US4): Public page ETA display
7. Phase 7: Polish + CLAUDE.md + typecheck

---

## Notes

- No automated tests exist in this project; verification is typecheck + observed behaviour
- `[P]` tasks = different files, no blocking dependencies on other in-flight tasks
- The T010 typecheck after Phase 2 is a hard gate — do not start US1 work if it fails
- ETA changes never increment `updateCount` (consistent with speed/duration change exemption)
- Traffic mode rewrite (T009) must preserve saving/restoring `truckSpeedMph` — do not lose the pre-traffic speed
