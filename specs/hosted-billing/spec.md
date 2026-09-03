# Hosted billing (Stripe)

## Outcome

The hosted product at ohmyself.ai can charge without billing people who self-host the MIT server.

## Packaging

One number: notes. Features are inclusions, not extra meters.

- **Free ($0):** 100 notes. Web only.
- **Basic ($10/mo or $100/yr):** 2,000 notes. Cursor, ChatGPT, Claude (MCP).
- **Pro ($20/mo or $200/yr):** unlimited notes. Meetings and company wikis.

Yearly is 2 months free. Self-host (`OMS_ENFORCE_PRO` unset) never paywalls.

When a Free or Basic user hits the note cap, create-note returns **402** `note_cap` and the web shows: “You used X of Y notes on Free. Upgrade to Basic (2,000 notes) or delete some.”

## Kill-switch

`OMS_ENFORCE_PRO=true` on Railway turns gates on. Default is off.

When on:

- Note create in a personal brain is capped (100 / 2,000 / unlimited)
- `POST /mcp` and creating MCP tokens require **Basic** (public-agent token excluded)
- Company spaces, connector sync, and semantic graph require **Pro**

## Stripe

- Hosted Checkout + Customer Portal (no card form in-app)
- Webhook `POST /webhooks/stripe` (rewritten from www → Railway)
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_BASIC_ANNUAL`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL` (legacy `STRIPE_PRICE_MONTHLY` / `ANNUAL` still map to Pro)

## Data

`public.entitlements` + date-aware `is_pro(user_id)` + `tier` (`basic` | `pro` | null). Null on a paying row is Pro (grandfather). Existing profiles are grandfathered Pro for 90 days when the first entitlements migration runs.

## Acceptance

1. Self-host with `OMS_ENFORCE_PRO` unset: MCP and tokens work as today.
2. Hosted Free: web brain works until 100 notes; note 101 and MCP return 402 with `upgrade_url`.
3. Checkout Basic → webhook → MCP works; still 402 on company spaces.
4. Checkout Pro → unlimited notes + meetings/wikis.
5. Public agent token still works without a paid plan.
