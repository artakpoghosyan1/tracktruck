# API Contract Changes

All changes follow Constitution Principle I: edit `openapi.yaml` first, run codegen, then implement.

---

## New Endpoint: `GET /api/utils/timezone`

Returns the IANA timezone for a geographic coordinate. Called by the frontend when the route endpoint marker is placed or moved.

**Request**:
```
GET /api/utils/timezone?lat=33.4484&lng=-112.0740
```
No authentication required (public utility, no sensitive data).

**Response** `200 OK`:
```yaml
TimezoneResponse:
  type: object
  required: [timezone, label]
  properties:
    timezone:
      type: string
      description: IANA timezone identifier
      example: "America/Phoenix"
    label:
      type: string
      description: Human-readable label for display
      example: "Mountain Standard Time (MST)"
```

**Error** `400`:
```json
{ "error": "invalid_coordinates", "message": "lat/lng out of range" }
```

---

## Modified Schema: `RouteDetail`

### Remove fields:
```yaml
# REMOVED:
customDurationS:
  type: integer
  nullable: true
```

Note: `customDurationEnabled` was never in RouteDetail schema but is removed from server response too.

### Add fields:
```yaml
etaTargetUtc:
  type: string
  format: date-time
  nullable: true
  description: UTC timestamp of target arrival. Null = no ETA set.
  example: "2026-06-08T22:00:00.000Z"
etaTimezone:
  type: string
  nullable: true
  description: IANA timezone of the destination, for display purposes.
  example: "America/Phoenix"
```

---

## Modified Schema: `RouteListItem`

### Remove:
```yaml
customDurationS:
  type: integer
  nullable: true
```

### Add:
```yaml
etaTargetUtc:
  type: string
  format: date-time
  nullable: true
etaTimezone:
  type: string
  nullable: true
```

---

## Modified Endpoint: `PATCH /routes/:id/speed`

This endpoint handles all timing and speed controls. Custom duration fields are removed; ETA fields are added.

### Request body — remove:
```yaml
customDurationS:
  type: integer
  nullable: true
customDurationEnabled:
  type: boolean
```

### Request body — add:
```yaml
etaTargetUtc:
  type: string
  format: date-time
  nullable: true
  description: Pass null to clear the ETA.
etaTimezone:
  type: string
  nullable: true
  description: Required when etaTargetUtc is non-null.
```

### Response — remove:
```yaml
customDurationS: ...
customDurationEnabled: ...
```

### Response — add:
```yaml
etaTargetUtc:
  type: string
  format: date-time
  nullable: true
etaTimezone:
  type: string
  nullable: true
```

---

## Modified Endpoints: `POST /routes` and `PUT /routes/:id`

These endpoints also currently include `customDurationS` in their request/response. Remove `customDurationS` from both. ETA is not set via route create/update — only via `PATCH /routes/:id/speed`.

---

## Modified Schema: `SimulationSnapshot` (WebSocket broadcast)

### Add fields:
```yaml
etaTargetUtc:
  type: string
  format: date-time
  nullable: true
  description: Current ETA target if set, for public page display.
etaTimezone:
  type: string
  nullable: true
```

These are read-only in the snapshot; they reflect the route's current ETA setting at broadcast time.

---

## Unchanged

- All stop endpoints (`POST /routes/:id/stops`, `PUT /routes/:id/stops/bulk`, etc.) — no changes
- All simulation lifecycle endpoints (`/activate`, `/start`, `/pause`, `/resume`) — no changes
- Public tracking endpoints — snapshot shape change (add ETA fields) is the only touch
- Auth, org, admin endpoints — untouched
