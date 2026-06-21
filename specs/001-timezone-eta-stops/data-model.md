# Data Model: Timezone-Aware Destination ETA

## Schema Changes — `routes` table (`lib/db/src/schema/routes.ts`)

### Remove

```typescript
customDurationS: doublePrecision("custom_duration_s"),
customDurationEnabled: boolean("custom_duration_enabled").notNull().default(false),
```

### Add

```typescript
etaTargetUtc: timestamp("eta_target_utc"),               // nullable; UTC arrival target
etaTimezone: text("eta_timezone"),                        // nullable; IANA tz, e.g. "America/Phoenix"
```

**Constraints**:
- Both are nullable; null = no ETA set, route uses natural speed
- `etaTimezone` is set when `etaTargetUtc` is set; cleared together
- `etaTargetUtc` must be in the future at the time it is saved (enforced in API layer)
- No new indexes needed (ETA fields are not queried in WHERE clauses, only read)

---

## No Other Schema Changes

All other tables (`simulation_states`, `route_stops`, `share_links`, `live_snapshots`) are unchanged. The ETA is a route-level timing constraint — stop dwell times stay on `route_stops.durationMinutes` as before.

---

## Derived / Computed Values (not persisted)

These are calculated in the simulation worker and API at runtime — never stored:

| Value | Formula | Where computed |
|-------|---------|----------------|
| `etaDurationS` | `(etaTargetUtc_ms − startedAt_ms) / 1000` | simulation-worker tick |
| `speedMultiplier` | `estimatedDurationS / etaDurationS` (or 1.0 if no ETA) | simulation-worker tick |
| `requiredSpeedMph` | `(distanceM / 1609.34) / ((etaDurationS − existingDwellS) / 3600)` | frontend ETA widget |
| `suggestedStopCount` | `ceil(additionalDwellNeeded / 7200)` | frontend ETA widget |
| `suggestedStopDwellMin` | `additionalDwellNeeded / stopCount / 60` | frontend ETA widget |
| `suggestedStopPositions` | evenly spaced polyline fractions (5%–95%) | frontend ETA widget |

---

## State Transitions

ETA fields follow route lifecycle without additional states:

| Route Status | ETA Behaviour |
|-------------|---------------|
| `draft` | ETA can be set or cleared freely |
| `ready` | ETA can be set or cleared freely |
| `in_progress` | ETA can be edited; worker picks up new value on next tick |
| `paused` | ETA can be edited; applied when resumed |
| `completed` | ETA fields preserved for display (when was it supposed to arrive) |

---

## Traffic Mode Rewrite

Traffic mode no longer uses `customDurationS`. It now calls `PATCH /routes/:id/speed` with:
- **Enable traffic**: `{ truckSpeedMph: <random 19–22 mph> }` — saves the previous `truckSpeedMph` in frontend state for restore
- **Disable traffic**: `{ truckSpeedMph: <saved previous speed> }`

No DB schema change required.
