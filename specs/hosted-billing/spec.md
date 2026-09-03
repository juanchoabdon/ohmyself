# Hosted billing (Stripe)

## Outcome

The hosted product at ohmyself.ai can charge for Pro without billing people who self-host the MIT server.

## Packaging

- **Free:** personal brain on the web (browse, edit, search, privacy).
- **Pro ($9.99/mo or $99/yr):** MCP agents, company wikis, connectors / meeting distill, deep research, semantic map.

Self-host (`OMS_ENFORCE_PRO` unset) never paywalls.

## Kill-switch

`OMS_ENFORCE_PRO=true` on Railway turns gates on. Default is off, so merging this does not cut existing users.

When on:

- `POST /mcp` returns **402** unless `is_pro()` (public-agent token excluded)
- Creating MCP tokens, company spaces, connector sync, and semantic graph require Pro

## Stripe

- Hosted Checkout + Customer Portal (no card form in-app)
- Webhook `POST /webhooks/stripe` (rewritten from www → Railway)
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`

## Data

`public.entitlements` + date-aware `is_pro(user_id)`. Existing profiles are grandfathered Pro for 90 days when the migration runs.

## Acceptance

1. Self-host with `OMS_ENFORCE_PRO` unset: MCP and tokens work as today.
2. Hosted with enforcement on, free user: web brain works; MCP and token create return 402 with `upgrade_url`.
3. Checkout → webhook → `is_pro()` true; portal can cancel.
4. Public agent token still works without Pro.
