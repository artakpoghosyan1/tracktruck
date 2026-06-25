# Feature Specification: Timezone-Aware Destination ETA with Stop Suggestions

**Feature Branch**: `001-timezone-eta-stops`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "add a timezone based destination duration setting ability. In the USA there are several timezones, means what a route start point and end point can have different timezones. The dashboard user when creates a route can specify at what time the track should reach to the destination considering the timezones. So let's imagine this scenario: user sets a destination duration which is too long for that route and it will reach to it in 6hours instead of naturally 30min, the system should offer adding a stop or multiple stops to make this track movement realistic. It means that if to make the track to reach the destination in a 6 hours it should move with 5mph speed, which is not realistic, so the system should calculate and offer adding a stop or stops with certain duration to make the track move with normal speed. User can add and remove the duration whenever they want, even on in progress route. It should be editable. One thing that you should think how to do is the stop setting suggestion, the question is should we provide a ability to add stops from the destination duration widget or let user go to set the stops, save then submit the duration."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set Timezone-Aware Arrival Time (Priority: P1)

A dashboard user building a route that crosses timezone boundaries (e.g., a driver starting in Los Angeles and arriving in Phoenix) needs to specify the exact local arrival time at the destination. The user picks "arrive by 3:00 PM Phoenix time." The system automatically detects that the destination is in the Mountain timezone (UTC-7, no DST), converts this to a trip duration from the route's planned start, and applies it as the target arrival constraint — replacing the previous custom-duration workflow.

**Why this priority**: This is the core feature. Without it, the remaining stories have no foundation.

**Independent Test**: Can be fully tested by creating a route with start/end points in different US timezones, setting an arrival time, and verifying the computed trip duration correctly accounts for the timezone offset.

**Acceptance Scenarios**:

1. **Given** a route whose destination lies in a different US timezone than the origin, **When** the user inputs a wall-clock arrival time at the destination, **Then** the system displays the destination's detected timezone name, computes the correct trip duration accounting for the timezone offset, and stores it as the route's target arrival constraint.
2. **Given** the user sets an arrival time that is in the past relative to the current moment (or before the route's start time), **When** they submit the ETA, **Then** the system rejects the input with a clear error message explaining the arrival time must be in the future.
3. **Given** the user wants to override the auto-detected timezone, **When** they select a different timezone from the displayed list, **Then** the arrival time recomputes against the chosen timezone and the route duration updates accordingly.
4. **Given** a user removes the ETA entirely, **When** they clear the field and confirm, **Then** the route reverts to speed-limit-based natural timing and any ETA-driven stop suggestions are dismissed.

---

### User Story 2 - Realistic Speed Warning & Stop Suggestions (Priority: P1)

A user sets an arrival time that results in a required average moving speed below a realistic minimum for road travel (e.g., the route is 25 miles but the ETA requires 6 hours of travel, implying roughly 4 mph). The system detects this and surfaces a warning alongside a calculated suggestion: add N stops totaling X hours of dwell time so the vehicle moves at a realistic speed between stops.

**Why this priority**: Without this, users can set physically implausible routes. The suggestion system is the primary UX value of the feature beyond simple ETA entry.

**Independent Test**: Can be tested independently by setting an ETA on a short route that forces unrealistically slow movement, verifying the suggestion panel appears with a calculated stop count and dwell duration, and confirming those values mathematically produce a realistic moving speed.

**Acceptance Scenarios**:

1. **Given** an ETA is set that requires average moving speed below 10 mph, **When** the ETA is applied, **Then** the system displays a warning indicating the speed would be unrealistic and shows a suggestion panel with a recommended number of stops and total dwell time needed to bring moving speed to a realistic range.
2. **Given** the suggestion panel is shown with 2 suggested stops of 2.5 hours each, **When** the user accepts the suggestion, **Then** stops are added to the route at evenly-distributed positions along the polyline with the suggested dwell times, and the realistic-speed warning disappears.
3. **Given** the required moving speed is within the realistic range (10–75 mph), **When** the ETA is set, **Then** no stop suggestion is shown; the ETA is applied silently.
4. **Given** the user sets an ETA but rejects all stop suggestions, **When** they save the route, **Then** the ETA is stored as-is with a persistent advisory note that the route will move at an unrealistically slow speed.

---

### User Story 3 - Edit ETA on In-Progress Route (Priority: P2)

A dashboard user whose route is already running (`in_progress`) needs to update the arrival time — for example, the driver called in a delay or the dispatcher needs to adjust the planned arrival. The user opens the ETA widget while the route is live, changes the arrival time, and the simulation engine immediately recalculates the speed multiplier from the current position forward without resetting or jumping the marker.

**Why this priority**: The feature description explicitly requires editability at any lifecycle stage. P2 because it depends on P1 being established first.

**Independent Test**: Can be tested by starting a route, letting it run for a short time, then changing the ETA and verifying the tracker's projected arrival time updates in real time without the marker jumping or the route resetting.

**Acceptance Scenarios**:

1. **Given** a route is `in_progress` with an active ETA, **When** the user changes the arrival time in the ETA widget, **Then** the simulation engine recalculates remaining distance and adjusts speed from the current position forward; the marker does not jump or reset.
2. **Given** a route is `paused` with an active ETA, **When** the user edits the arrival time, **Then** the new ETA is stored and applied when the route resumes.
3. **Given** the new ETA on a running route would again require unrealistic speed for the remaining distance, **When** the user saves it, **Then** the stop suggestion panel reappears with updated calculations based on remaining distance, not total route distance.
4. **Given** the user adds ETA-driven stops to an in-progress route, **When** the stops are applied, **Then** the engine recomputes from the current position as it does for any live stop addition (consistent with existing stop-editing behavior).

---

### User Story 4 - ETA Display on Public Tracking Page (Priority: P3)

The public tracking page shows the simulated vehicle's live position. When a route has an active ETA set, the public page displays the estimated arrival time (in the destination's local timezone), updating in real time as the simulation progresses.

**Why this priority**: Pure display enhancement. The feature delivers full value without it; adds transparency for public viewers.

**Independent Test**: Can be tested by opening the public share link for a route with an active ETA and confirming the arrival time is shown in the correct local timezone and updates on each position tick.

**Acceptance Scenarios**:

1. **Given** a route has an ETA set, **When** a viewer opens the public tracking page, **Then** the estimated arrival time is displayed in the destination's local timezone with the timezone label (e.g., "3:00 PM MT").
2. **Given** no ETA is configured, **When** a viewer opens the public tracking page, **Then** no arrival time estimate is shown.

---

### Edge Cases

- **Timezone boundary ambiguity**: When reverse-geocoding the destination produces an ambiguous timezone result, the system uses the IANA timezone covering the larger population area at that coordinate. The user-visible timezone label is always shown so the user can override it if incorrect.
- **DST transitions during a simulated trip**: The target arrival moment is fixed as an absolute UTC time at the moment the ETA is set. If a Daylight Saving Time transition occurs while the route is running, it does not retroactively shift the target — the simulation continues toward the same UTC endpoint.
- **Suggested stops already passed mid-route**: When the user edits an ETA on a route that is already `in_progress`, the system calculates stop suggestions based solely on the remaining distance from the vehicle's current position to the destination — it does not consider the portion of the route already traveled.
- **Existing manual stops**: Any stops already on the route are counted toward the total dwell time when the system evaluates whether additional stops are needed. If their combined dwell time already brings the required moving speed into the realistic range, no additional stops are suggested.
- **Custom duration feature**: The existing custom-duration feature (`customDurationEnabled` / `customDurationS`) is removed entirely as part of this work. All related UI, API fields, engine logic, and database columns are cleaned up. The ETA feature is its full replacement.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically detect the timezone of the destination point based on its geographic coordinates.
- **FR-002**: System MUST allow the user to set a wall-clock arrival time expressed in the destination's local timezone.
- **FR-003**: System MUST display the detected destination timezone name alongside the arrival time input so the user can confirm it.
- **FR-004**: System MUST allow the user to override the auto-detected destination timezone from a list of US timezones.
- **FR-005**: System MUST compute and store the target trip duration by converting the local arrival time to an absolute UTC moment and subtracting the route start time.
- **FR-006**: System MUST reject arrival times that fall in the past relative to the current moment or before the route's planned start time, with a clear inline error.
- **FR-007**: System MUST define a realistic moving speed range (minimum 10 mph, maximum 75 mph) for road-vehicle routes and compare the required average speed against this range when an ETA is set.
- **FR-008**: When the required average moving speed falls below the realistic minimum, the system MUST display a warning and present a stop suggestion panel showing the recommended number of stops and individual dwell durations calculated to bring moving speed back into the realistic range.
- **FR-009**: System MUST calculate suggested stop positions as evenly distributed points along the route polyline.
- **FR-010**: [NEEDS CLARIFICATION: Stop suggestion UX — should the user be able to accept and add suggested stops directly from the ETA widget, or must they navigate to the stops section to add stops manually before the ETA can be finalized?]
- **FR-011**: System MUST allow the user to remove the ETA at any time; on removal the route reverts to speed-limit-based natural timing.
- **FR-012**: System MUST allow the user to edit the ETA on a route in any lifecycle state: `draft`, `ready`, `in_progress`, or `paused`.
- **FR-013**: When the ETA is edited on an `in_progress` or `paused` route, the system MUST recalculate speed from the vehicle's current position forward without resetting or repositioning the marker.
- **FR-014**: When an ETA is active and the route is running, the system MUST include the estimated arrival time (in destination local timezone) in the data broadcast to the public tracking page.
- **FR-015**: The existing custom-duration feature (`customDurationEnabled` / `customDurationS`) MUST be removed from the system — including all UI controls, API fields, simulation engine logic, and database columns. The ETA feature is its complete replacement.
- **FR-016**: When existing manual stops are present on the route and an ETA is set, the system MUST factor in their total dwell time when calculating whether additional stops are needed to achieve realistic speed.

### Key Entities

- **Route ETA**: Target arrival wall-clock time, destination timezone (auto-detected + user-overridable), computed trip duration in seconds, last-updated timestamp.
- **Timezone Record**: IANA timezone identifier (e.g., `America/Phoenix`), display name, UTC offset at the relevant simulation time (accounting for DST).
- **Stop Suggestion**: Suggested position along polyline (as a lat/lng or polyline fraction), suggested dwell duration in minutes, accepted/dismissed state.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can set or update a timezone-aware arrival time in under 30 seconds on both new and in-progress routes.
- **SC-002**: The system correctly accounts for timezone offset (including DST) in 100% of tested US timezone pairs — arrival time displayed to the user matches the expected local clock.
- **SC-003**: When an ETA requires unrealistic speed, the stop suggestion panel appears within 1 second of the user confirming the ETA value, with mathematically correct stop count and dwell times.
- **SC-004**: Editing an ETA on a running route produces no visible jump or discontinuity in the tracked marker position on the public page.
- **SC-005**: 90% of users who encounter the stop suggestion panel are able to understand and act on the suggestion without additional guidance (measured by task-completion observation or in-app feedback).

---

## Assumptions

- The feature targets US-only timezone detection for v1; international timezones are out of scope.
- Timezone of the destination is determined by geographic coordinates via a timezone lookup (no manual lat/lng input from the user).
- "Realistic speed range" for road-vehicle simulation is defined as 10 mph minimum to 75 mph maximum; these values are configurable at the system level but are not user-facing controls.
- The existing custom-duration feature is fully removed; all related UI, API fields, engine logic, and database columns are deleted as part of this work — not deprecated or hidden.
- Routes using speed-limit-based natural timing (no ETA) are unaffected by the removal.
- Stop positions suggested by the system are calculated from route geometry already available in the polyline; no additional geocoding of stop names is required.
- The `updateCount` one-edit restriction for `user` role applies to the route's structural fields; ETA changes (like speed/duration changes) are exempt from this restriction and do not increment `updateCount`.
- DST transitions during a simulated trip are handled by computing the absolute UTC arrival moment at the time the ETA is set; mid-trip DST rollovers do not retroactively alter the target.
