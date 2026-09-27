# Design Specification — SOC-Dashboard Theme

> **Colour is superseded — read this first.**
> The palette below describes the original muted SOC panel. The user later
> asked for something more vibrant, so the live palette is defined in
> `frontend/tailwind.config.js` and deliberately departs from the Colour
> palette section here: per-category identity hues, gradients, and glows.
> Also superseded: the login framing (`> access_terminal` became the Dayshift
> wordmark, and there is now a first-run setup screen) and the 2-4px corner
> radius (panels are 8px, once they gained real elevation).
> Everything else — typography, layout principles, the warning-state
> *mechanism* (border and glow, never popups), and the responsive rules —
> still applies as written.
> The replacement palette was validated for colour-blind separation and
> contrast; see the note at the top of `tailwind.config.js`.

## Intent
This should feel like a restrained security-operations monitoring panel, not a consumer habit app. Calm, legible, data-dense without clutter. Explicitly avoid: bright neon "hacker" cliché green-on-black, generic SaaS card grids, Bootstrap-default look, and anything that reads as a to-do list app.

## Color palette

### Base
- Background (primary): `#1a1d23` — dark graphite, not pure black
- Background (panel/surface): `#20242c`
- Background (raised/hover): `#262b34`
- Border (default): `#2e333d`
- Border (subtle divider): `#252932`

### Text
- Primary text: `#e4e6eb`
- Secondary/muted text: `#8b929e`
- Disabled/placeholder: `#565c68`

### Accent — status colors (muted, not saturated)
- On-target / healthy: `#3ecf8e` (muted terminal green, not neon `#00ff00`)
- Warning (below 80% par): `#e0a458` (muted amber, not bright orange)
- Critical (below 50% par, or 3+ days warning): `#d9695f` (desaturated red)
- Neutral accent / links / active state: `#5b9dd9` (muted steel blue — used sparingly, not as a dominant color)

### Do not use
- Pure black (`#000000`) or pure white backgrounds
- Saturated neon green, red, or blue
- Purple/violet gradients (generic SaaS default)
- More than one accent color per component

## Typography
- **Data/numbers (par scores, minute counts, dates):** monospace — `'JetBrains Mono', 'Fira Code', monospace` (load via Google Fonts or self-hosted, whichever `app.py`'s static setup makes simpler)
- **Labels, body text, nav:** sans-serif — `'Inter', -apple-system, sans-serif`
- **Sizing:** base 14-15px body, numbers in dashboard gauges can run larger (24-32px) since they're the focal data points
- Avoid using more than these two typefaces total.

## Layout principles
- **No plain rectangular card grids.** The dashboard's three categories should each render as a **radial/gauge indicator** (SVG arc showing % of target achieved) rather than a horizontal progress bar inside a box.
- **Daily log entry** should look like a **terminal/log-stream input** — monospace field, left-aligned, dark input background slightly darker than the surface it sits on, a blinking cursor or `>` prompt-style affordance is a nice touch but optional.
- **Weekly view**: hand-built SVG bar chart, thin bars, muted colors matching the status palette above (green/amber/red per day based on that day's par score) — not a rounded, drop-shadowed "modern dashboard" bar chart.
- Generous whitespace between sections — avoid cramming; the "SOC panel" feel comes from restraint, not density for its own sake.
- Corners: slight rounding only (2-4px radius) — sharp enough to feel technical, not sharp enough to feel harsh. Avoid fully squared-off 0px corners (too stark) and avoid heavily rounded 12px+ corners (too soft/consumer-app).

## Warning state behavior
When a category drops below 80% par for 2+ consecutive days:
- The gauge's border/glow shifts from the healthy green to the amber warning color
- A small persistent text label appears near the gauge (e.g., "2d below target") in the muted text color, not bold/alarming
- No modal, no toast notification, no `alert()` — the visual state change on the gauge itself is the entire warning mechanism

Below 50% par, or 3+ consecutive days below 80%: shift to the critical red state, same mechanism, slightly more visually present (e.g., a subtle pulsing border animation, kept slow/subtle — not flashing).

## Login page
- Minimal: centered password field on the dark background, no branding/logo needed beyond a small monospace title (e.g., `> access_terminal` or similar restrained framing — avoid anything cheesy like ASCII skull art or "HACKER LOGIN")
- Error state (wrong password): border of the input field shifts to the critical red, small text below in the same red, no page reload/flash

## Responsive behavior
- Should be usable on both a laptop screen and a phone browser (in case checked on mobile), but optimize primarily for desktop/laptop since that's the expected primary use case. Stack gauges vertically on narrow viewports rather than shrinking them illegibly small.
