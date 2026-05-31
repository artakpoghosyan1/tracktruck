<!--
Draft input for /speckit-specify. After restarting the session, run:

  /speckit-specify <paste everything below the line>

Then refine with /speckit-clarify before /speckit-plan. This file is a scratch
draft only; it is not consumed by Spec Kit scripts.
-->

---

Feature: Share-link expiry and an honest expired-route experience.

WHY / problem
When an operator activates a route, the system creates a public share link stamped with a
7-day validity window — but that window is never enforced, so the link keeps working
indefinitely as long as it stays active. The data model also defines an `expired` route
status that is never assigned. The result is that there is no truthful "this tracking link
has expired" experience: a stale link either keeps showing live tracking forever, or it
collapses into the same generic "no active route found" message used for invalid and deleted
links. This feature gives share links a real, enforced lifetime and gives viewers an accurate
expired state, closing two long-standing intent-vs-implementation gaps.

WHAT should happen (user-facing outcomes)
- Every public share link has a fixed validity window of 7 days that begins when the route is
  activated (matching the value the system already stamps today).
- Once a link is past its window it must no longer reveal live tracking to anyone — including
  a viewer who already has the public page open or an active live connection.
- A route whose link has expired, and which has not already completed, is reflected as
  `expired` in its lifecycle — a state distinct from `completed`.
- A viewer who opens an expired link sees a dedicated "tracking link expired" screen that is
  clearly distinguishable from: (a) a live/active route, (b) a completed route, and (c) an
  invalid / unknown / revoked link.
- The operator/admin can see, per route, when its link expires (or how much time remains) and
  whether the route is currently expired.
- Expiry does not refund quota: an activation whose link later expires still counts against the
  member's used-routes total, consistent with how used routes already behave.

OUT OF SCOPE (v1)
- Making the 7-day window configurable per organization, route, or tier.
- A dedicated "extend link" action. Obtaining a fresh link means re-activating the route, which
  already mints a new link and a new window.
- Changing how invalid / deleted / deactivated links behave, beyond giving "expired" its own
  distinct screen.

OPEN QUESTIONS (resolve via /speckit-clarify)
- When a route is still in progress at the 7-day mark, does the simulation stop and the route
  become `expired`, or does the run finish first with expiry applying only to the public link?
  (Recommended: link expiry takes precedence — stop the simulation and mark the route expired.)
- If a viewer is watching live at the moment of expiry, should the view switch to the expired
  screen immediately, or only on the next page load? (Recommended: switch as promptly as is
  practical, so an expired link never shows motion.)
- Is `completed` terminal — i.e., can a completed route's link still "expire," or does
  expiry apply only to routes that have not completed? (Recommended: `completed` is terminal;
  only not-yet-completed routes can become `expired`.)
- Does the admin need a way to re-activate / re-link directly from the expired state, or is the
  existing activation flow sufficient?
