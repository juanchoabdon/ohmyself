# DESIGN — ohmyself!

Built following the `impeccable` skill. Light mode only (no dark mode).

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

## Bans (from impeccable)
No dark mode, no gradient text, no glassmorphism, no per-section eyebrows, no
identical card grids, no cream/sand body background.
