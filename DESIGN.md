# DESIGN — ohmyself!

Built following the `impeccable` skill. Light + dark themes, selected by the
`data-theme` attribute on `<html>` (set pre-paint to avoid flash; toggled via
`ThemeToggle`, persisted to `localStorage('oms-theme')`, defaults to system).
Every color is a CSS variable so both themes adapt with no per-component dark:
overrides.

## Theme & color (OKLCH)
Calm, paper-adjacent but NOT the cream/sand AI default. A true near-white canvas
with a single committed brand hue (deep indigo) used sparingly for actions and
focus, plus semantic colors for the three privacy levels.

Tokens (see `web/app/globals.css`):
- `--bg`        oklch(0.99 0.002 270)   near-white canvas (chroma ~0, faint cool)
- `--surface`   oklch(1 0 0)            cards/panels
- `--border`    oklch(0.92 0.004 270)
- `--ink`       oklch(0.24 0.02 270)    body text (≥ 4.5:1 on bg)
- `--muted`     oklch(0.5 0.02 270)     secondary text (still ≥ 4.5:1)
- `--brand`     oklch(0.52 0.17 275)    indigo — primary actions, focus ring
- `--brand-weak` oklch(0.96 0.03 275)   tints
- privacy: public `oklch(0.55 0.13 150)` (green), private `oklch(0.55 0.02 270)`
  (neutral), secret `oklch(0.55 0.16 25)` (red-orange)

## Type
System UI stack; one family, multiple weights. Body 15–16px, line-height 1.6,
prose width capped ~70ch. Headings use `text-wrap: balance`.

## Layout
Three zones: a fixed left rail (brain tree + search), a reading column (rendered
note), and a slide-in chat panel. Flexbox for the shell, no nested cards. Privacy
shown as a small pill, never a side-stripe border.

## Motion
Subtle, ease-out. Panel slides and list fades only; respect
`prefers-reduced-motion`. No bounce, no decorative animation.

## Dark theme (OKLCH)
Warm-neutral dark, NOT pure black: bg `oklch(0.185 …)` canvas, `surface`
elevated above it for sidebar/header/cards/inputs, `elevated` for modals. Same
coral identity, slightly lightened (`--brand` ~L0.72) so it glows on dark.
Privacy colors lightened for legibility. Verified body/muted contrast ≥ 4.5:1.

## Bans (from impeccable)
No gradient text in product UI, no glassmorphism, no per-section eyebrows, no
identical card grids, no cream/sand body background.
