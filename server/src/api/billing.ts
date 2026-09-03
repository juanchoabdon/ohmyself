import type { Hono } from "hono";
import type { AuthContext } from "../core/types.js";
import { BadRequestError } from "../core/errors.js";
import {
  constructStripeEvent,
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  handleStripeEvent,
  stripeConfigured,
  type BillingPlan,
  type PaidTier,
} from "../core/billing.js";

type Env = { Variables: { auth: AuthContext } };

function isInterval(v: unknown): v is BillingPlan {
  return v === "monthly" || v === "annual";
}

function isPaidTier(v: unknown): v is PaidTier {
  return v === "basic" || v === "pro";
}

/** Unauthenticated Stripe webhook. Must be registered before the /v1 auth guard. */
export function registerBillingWebhook(app: Hono<Env>): void {
  app.post("/webhooks/stripe", async (c) => {
    const signature = c.req.header("stripe-signature");
    if (!signature) throw new BadRequestError("missing stripe-signature");
    const raw = await c.req.text();
    let event;
    try {
      event = constructStripeEvent(raw, signature);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid signature";
      return c.json({ error: message }, 400);
    }
    try {
      await handleStripeEvent(event);
    } catch (err) {
      console.error("[billing] webhook handler failed:", err);
      return c.json({ error: "webhook handler failed" }, 500);
    }
    return c.json({ received: true });
  });
}

/** Authenticated billing routes. Call after the /v1 auth middleware. */
export function registerBillingRoutes(app: Hono<Env>): void {
  app.get("/v1/billing/status", async (c) => {
    const auth = c.get("auth");
    return c.json(await getBillingStatus(auth.userId));
  });

  app.post("/v1/billing/checkout", async (c) => {
    const auth = c.get("auth");
    if (auth.via !== "jwt") throw new BadRequestError("subscribe from a signed-in session");
    if (!stripeConfigured()) throw new BadRequestError("billing is not configured");
    const body = (await c.req.json().catch(() => ({}))) as { tier?: string; interval?: string; plan?: string };
    const tier: PaidTier = isPaidTier(body.tier) ? body.tier : "pro";
    const interval: BillingPlan = isInterval(body.interval)
      ? body.interval
      : isInterval(body.plan)
        ? body.plan
        : "annual";
    const { url } = await createCheckoutSession(auth.userId, tier, interval);
    return c.json({ url });
  });

  app.post("/v1/billing/portal", async (c) => {
    const auth = c.get("auth");
    if (auth.via !== "jwt") throw new BadRequestError("manage billing from a signed-in session");
    const { url } = await createPortalSession(auth.userId);
    return c.json({ url });
  });
}
