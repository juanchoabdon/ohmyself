/**
 * Hosted billing. Self-host (OMS_ENFORCE_PRO unset) never paywalls.
 *
 * Stripe Checkout + Customer Portal + webhook write `entitlements`.
 * `is_pro()` in Postgres is the date-aware source of truth.
 */
import Stripe from "stripe";
import { findById } from "./users.js";
import { serviceClient } from "./supabase.js";
import { BadRequestError, PaymentRequiredError } from "./errors.js";

export type EntitlementStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "grandfathered"
  | "lifetime";

export type BillingPlan = "monthly" | "annual";

export interface Entitlement {
  userId: string;
  status: EntitlementStatus;
  plan: BillingPlan | null;
  source: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  grandfatherUntil: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
}

export interface BillingStatus {
  enforced: boolean;
  pro: boolean;
  entitlement: Entitlement | null;
  upgradeUrl: string;
}

interface EntitlementRow {
  user_id: string;
  status: EntitlementStatus;
  plan: BillingPlan | null;
  source: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  grandfather_until: string | null;
  cancel_at_period_end: boolean;
}

let _stripe: Stripe | null = null;

export function billingEnforced(): boolean {
  return process.env.OMS_ENFORCE_PRO === "true";
}

export function upgradeUrl(): string {
  const web = (process.env.PUBLIC_WEB_URL || "https://www.ohmyself.ai").replace(/\/+$/, "");
  return `${web}/upgrade`;
}

function stripeSecret(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key || null;
}

export function stripeConfigured(): boolean {
  return Boolean(
    stripeSecret() && process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_PRICE_ANNUAL,
  );
}

function stripe(): Stripe {
  const key = stripeSecret();
  if (!key) throw new BadRequestError("billing is not configured");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

function priceId(plan: BillingPlan): string {
  const id =
    plan === "annual" ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
  if (!id) throw new BadRequestError("billing prices are not configured");
  return id;
}

function unixSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  return new Date(ts * 1000).toISOString();
}

function periodEnd(sub: Stripe.Subscription): string | null {
  return iso(unixSeconds((sub as { current_period_end?: unknown }).current_period_end));
}

function trialEndOf(sub: Stripe.Subscription): string | null {
  return iso(unixSeconds((sub as { trial_end?: unknown }).trial_end));
}

function mapStatus(status: Stripe.Subscription.Status): EntitlementStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "active";
  }
}

function planFromSubscription(sub: Stripe.Subscription): BillingPlan | null {
  const price = sub.items.data[0]?.price;
  const id = typeof price === "string" ? null : price?.id;
  if (id && id === process.env.STRIPE_PRICE_ANNUAL) return "annual";
  if (id && id === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  const interval = typeof price === "string" ? null : price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return null;
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return {
    userId: row.user_id,
    status: row.status,
    plan: row.plan,
    source: row.source,
    currentPeriodEnd: row.current_period_end,
    trialEnd: row.trial_end,
    grandfatherUntil: row.grandfather_until,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    hasCustomer: Boolean(row.stripe_customer_id),
  };
}

export async function isPro(userId: string): Promise<boolean> {
  const sb = serviceClient();
  const { data, error } = await sb.rpc("is_pro", { p_user_id: userId });
  if (error) {
    console.error("[billing] is_pro rpc failed:", error.message);
    return false;
  }
  return data === true;
}

export async function getEntitlementRow(userId: string): Promise<EntitlementRow | null> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("entitlements")
    .select(
      "user_id,status,plan,source,stripe_customer_id,stripe_subscription_id,current_period_end,trial_end,grandfather_until,cancel_at_period_end",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as EntitlementRow;
}

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const enforced = billingEnforced();
  if (!enforced) {
    return { enforced: false, pro: true, entitlement: null, upgradeUrl: upgradeUrl() };
  }
  const row = await getEntitlementRow(userId);
  const pro = await isPro(userId);
  return {
    enforced: true,
    pro,
    entitlement: row ? toEntitlement(row) : null,
    upgradeUrl: upgradeUrl(),
  };
}

/** Public-agent calls and self-host never paywall. */
export async function requirePro(userId: string, via?: string | null): Promise<void> {
  if (!billingEnforced()) return;
  if (via === "public") return;
  if (await isPro(userId)) return;
  throw new PaymentRequiredError(
    "Connecting an agent is Pro. Start on the upgrade page.",
    upgradeUrl(),
  );
}

async function upsertEntitlement(patch: {
  userId: string;
  status: EntitlementStatus;
  plan?: BillingPlan | null;
  source?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("entitlements").upsert(
    {
      user_id: patch.userId,
      status: patch.status,
      plan: patch.plan ?? null,
      source: patch.source ?? "stripe",
      stripe_customer_id: patch.stripeCustomerId ?? null,
      stripe_subscription_id: patch.stripeSubscriptionId ?? null,
      current_period_end: patch.currentPeriodEnd ?? null,
      trial_end: patch.trialEnd ?? null,
      cancel_at_period_end: patch.cancelAtPeriodEnd ?? false,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);
}

async function userIdFromCustomer(customerId: string): Promise<string | null> {
  const sb = serviceClient();
  const { data } = await sb
    .from("entitlements")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function ensureCustomer(userId: string): Promise<string> {
  const existing = await getEntitlementRow(userId);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const profile = await findById(userId);
  const customer = await stripe().customers.create({
    email: profile?.email ?? undefined,
    name: profile?.display_name ?? undefined,
    metadata: { user_id: userId },
  });

  const sb = serviceClient();
  await sb.from("entitlements").upsert(
    {
      user_id: userId,
      status: existing?.status ?? "free",
      stripe_customer_id: customer.id,
    },
    { onConflict: "user_id" },
  );
  return customer.id;
}

export async function createCheckoutSession(
  userId: string,
  plan: BillingPlan,
): Promise<{ url: string }> {
  if (!stripeConfigured()) throw new BadRequestError("billing is not configured");
  const customer = await ensureCustomer(userId);
  const web = upgradeUrl();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    allow_promotion_codes: true,
    line_items: [{ price: priceId(plan), quantity: 1 }],
    success_url: `${web}?status=success`,
    cancel_url: `${web}?status=cancel`,
    metadata: { user_id: userId },
    subscription_data: { metadata: { user_id: userId } },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}

export async function createPortalSession(userId: string): Promise<{ url: string }> {
  if (!stripeConfigured()) throw new BadRequestError("billing is not configured");
  const row = await getEntitlementRow(userId);
  if (!row?.stripe_customer_id) {
    throw new BadRequestError("no billing customer yet — subscribe first");
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: upgradeUrl(),
  });
  return { url: session.url };
}

async function syncSubscription(sub: Stripe.Subscription, userId?: string | null): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const resolved =
    userId ||
    (typeof sub.metadata?.user_id === "string" ? sub.metadata.user_id : null) ||
    (customerId ? await userIdFromCustomer(customerId) : null);
  if (!resolved) {
    console.warn("[billing] subscription without user_id", sub.id);
    return;
  }
  await upsertEntitlement({
    userId: resolved,
    status: mapStatus(sub.status),
    plan: planFromSubscription(sub),
    source: "stripe",
    stripeCustomerId: customerId ?? null,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd(sub),
    trialEnd: trialEndOf(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.user_id || null;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subId) {
        const sub = await stripe().subscriptions.retrieve(subId);
        await syncSubscription(sub, userId);
      } else if (userId && session.customer) {
        const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
        await upsertEntitlement({
          userId,
          status: "active",
          source: "stripe",
          stripeCustomerId: customerId,
        });
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    default:
      return;
  }
}

export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new BadRequestError("webhook secret is not configured");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
