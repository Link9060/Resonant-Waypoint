# ARROW integrated beta warning for AI and developers

**The standalone Waypoint site is NOT the user's integrated ARROW Beta.**

User-facing integrated beta URL: https://link9060.github.io/Resonant-Relay/arrow/orbit/

To change the beta:
1. Open `Link9060/Resonant-Relay`, base branch **`beta`**.
2. Read `AGENTS.md`, `relay/scripts/build-arrow-beta.mjs`, and `relay/scripts/arrow-beta-centers.json` there.
3. Find the full commit SHA pinned under `Resonant-Waypoint` in that JSON.
4. Branch **from that pinned SHA**, not this repository's `main` and not a random feature branch.
5. Make, test and review changes on that pinned-derived branch.
6. Update the exact pinned SHA in a **Relay beta-targeted review PR**; otherwise the beta will keep packaging the older code.
7. Run integrated beta packaging checks and do not merge to `beta` or deploy without explicit user approval.

Standalone `Waypoint` PRs, including ones based on `main`, cannot be claimed as changes to the integrated beta until the Relay beta manifest points at their reviewed commits.

The actual Orbit UI includes global keyboard shortcuts and custom locations; the actual Waypoint UI includes live planning features. Preserve existing account and navigation functionality. Always compare the exact pinned version before applying changes.
