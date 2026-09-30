# Resonant Waypoint

Waypoint is ARROW's intention and execution layer.

Its job is to turn messy thoughts, commitments, ideas, goals, and time constraints into a clear direction and a realistic next move.

## Core structure

- **Today** — what deserves attention now
- **Capture** — unstructured thoughts interpreted by RAVIN into clarity, priorities, routes, and proposed actions
- **Plans** — projects, goals, milestones, and next actions
- **Calendar** — time blocks, deadlines, events, and routines
- **Direction** — priorities, horizons, values, and larger goals
- **Review** — progress, patterns, postponed work, and reflection

## Design identity

The Waypoint mark is a **Beacon**: a bright central destination point surrounded by thin signal rings.

Dark-first, glassy, minimal, and consistent with the broader ARROW family.

## Capture flow

The first prototype already supports:

1. Capture the messy, unorganized version of what is going on.
2. RAVIN reads the Capture against existing Waypoint context, then identifies intent, priorities, dependencies, conflicts, questions, a recommended route, and structured items.
3. Review the interpretation.
4. Nothing changes until the user approves it.
5. Approved tasks can be moved into Today.

RAVIN is the primary reasoning layer. A lightweight local classifier remains only as a fallback when the AI service is unavailable.

## GitHub Pages

This repository is configured for static Next.js export and GitHub Pages.

- `.github/workflows/deploy-pages.yml` builds and deploys on pushes to `main`.
- `.github/workflows/check.yml` validates pull requests.
- `next.config.ts` automatically applies the `/Resonant-Waypoint` base path when building in GitHub Actions.

Expected Pages URL:

`https://link9060.github.io/Resonant-Waypoint/`

In GitHub, set **Settings → Pages → Source** to **GitHub Actions** once if Pages has not already been enabled.
