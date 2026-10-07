# Resonant Waypoint

Waypoint is ARROW's intention and execution layer. It turns messy thoughts, commitments, ideas, goals, and time constraints into clear direction and realistic next moves, using RAVIN as its reasoning layer.

## Core structure

- **Today** — work due now, including overdue unresolved items
- **Capture** — free-form input interpreted by RAVIN into intent, signals, a route, questions, and proposed structured changes
- **Plans** — projects, future actions, parked ideas, and next moves
- **Calendar** — dated events and time commitments shared across ARROW
- **Direction** — account-backed goals and longer-range direction
- **Review** — current planning state and recent Capture history

## Production data model

Waypoint uses ARROW's universal Supabase account and Row Level Security.

- Shared actionable tasks live in `todos`.
- Shared dated events live in `relay_calendar_events`.
- Shared notes live in `notes`.
- Waypoint-specific projects, goals, future actions, and later items live in `waypoint_items`.
- Capture interpretations and application history live in `waypoint_captures`.
- All Waypoint tables use owner-only RLS policies.
- Capture application uses per-user idempotency keys so a retry does not duplicate tasks, events, or notes.
- Older browser-only Waypoint library data is migrated into the account-backed tables on startup.

## Capture flow

1. Write the unorganized version of what is going on.
2. RAVIN reads the Capture against the user's existing tasks, calendar, projects, goals, and parked work.
3. RAVIN identifies intent, priorities, dependencies, conflicts, constraints, opportunities, a recommended route, and unresolved questions.
4. Waypoint saves the interpretation to the user's Capture history.
5. The user reviews and selects proposed changes.
6. Nothing is applied until the user approves it.
7. Approved items are routed to Today, Plans, Calendar, Direction, Notes, or Later.
8. Writes are idempotent and account-backed, so the same planning state follows the user across devices.

A lightweight local classifier remains only as a fallback when the RAVIN service is unavailable.

## Reliability and security

- Universal ARROW authentication is required before Waypoint loads.
- Browser requests retry once after refreshing an expired ARROW session.
- Supabase requests and RAVIN inference have bounded timeouts.
- RAVIN's Waypoint endpoint is authenticated, payload-limited, origin-restricted, and rate-limited per account.
- Production writes are protected against accidental double-submit.
- `scripts/production-check.mjs` rejects known prototype regressions.
- Pull requests run locked dependency install, critical dependency audit, production checks, TypeScript, and a full static export build.
- Waypoint is pinned to Next.js 16.3.7.

## Deployment

The live ARROW deployment is:

- `https://enterarrow.com/waypoint/`
- Waypoint static upstream: Render, branch `enterarrow-domain`
- RAVIN intelligence upstream: Render, `Project-R.A.V.I.N.-1.1` branch `deployment-prep`

The repository also retains GitHub Pages support for development/backup builds. The live ARROW product should be tested through `enterarrow.com`, where the universal gateway and auth shell are present.


## ARROW beta review — October 6, 2026

ARROW’s shared account supports username/password registration without email or phone. Usernames use 3–20 letters, digits or underscores; new passwords require at least 12 characters. Recovery email can be linked and verified from Relay Profile → Sign-in and recovery; phone linking is offered only when SMS Auth is enabled. Existing Google and email sign-in remain available. New accounts still follow the existing beta approval policy.

The ARROW bar → Settings links to profile, notification device registration and setup, layout and particle preferences, privacy, terms, account export/deletion, and the setup guide. Appearance supports system/light/dark, reduced motion and custom accent color. Device preferences are separate from cloud account planning data.

Phone sign-in is currently blocked by `external.phone=false` in Supabase Auth. The UI detects that and explains the available alternatives. Enabling real SMS delivery requires a configured provider; code alone does not enable it.

This review also repairs shared panel Escape handling, failed task/event writes, stale panel responses, notification/help discoverability, light-theme surfaces and accent propagation. The 200 additional corrections listed in Relay’s `docs/arrow-ui-200.md` are individual small-text readability corrections, not 200 independent functionality bugs.
