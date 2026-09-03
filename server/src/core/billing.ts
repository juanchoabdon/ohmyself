/**
 * Hosted billing. Self-host (OMS_ENFORCE_PRO unset) never paywalls.
 *
 * Stripe Checkout + Customer Portal + webhook write `entitlements`.
 * `is_pro()` in Postgres is date-aware for any paying row; `hostedTier()`
 * splits Basic vs Pro. Note caps are the only usage meter users see.
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
export type HostedTier = "free" | "basic" | "pro";
export type PaidTier = "basic" | "pro";

export const NOTE_LIMIT: Record<HostedTier, number | null> = {
  free: 100,
  basic: 2_000,
  pro: null,
};

export interface Entitlement {
  userId: string;
  status: EntitlementStatus;
  plan: BillingPlan | null;
  tier: HostedTier | null;
  source: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  grandfatherUntil: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
}

export interface BillingUsage {
  notes: number;
  limit: number | null;
}

export interface BillingStatus {
  enforced: boolean;
  pro: boolean;
  paid: boolean;
  tier: HostedTier;
  usage: BillingUsage | null;
  entitlement: Entitlement | null;
  upgradeUrl: string;
}

interface EntitlementRow {
  user_id: string;
  status: EntitlementStatus;
  plan: BillingPlan | null;
  tier: PaidTier | null;
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

function envPrice(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function proMonthly(): string | undefined {
  return envPrice("STRIPE_PRICE_PRO_MONTHLY") || envPrice("STRIPE_PRICE_MONTHLY");
}
function proAnnual(): string | undefined {
  return envPrice("STRIPE_PRICE_PRO_ANNUAL") || envPrice("STRIPE_PRICE_ANNUAL");
}
function basicMonthly(): string | undefined {
  return envPrice("STRIPE_PRICE_BASIC_MONTHLY");
}
function basicAnnual(): string | undefined {
  return envPrice("STRIPE_PRICE_BASIC_ANNUAL");
}

export function stripeConfigured(): boolean {
  return Boolean(stripeSecret() && proMonthly() && proAnnual());
}

function stripe(): Stripe {
  const key = stripeSecret();
  if (!key) throw new BadRequestError("billing is not configured");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

function priceId(tier: PaidTier, interval: BillingPlan): string {
  const id =
    tier === "basic"
      ? interval === "annual"
        ? basicAnnual()
        : basicMonthly()
      : interval === "annual"
        ? proAnnual()
        : proMonthly();
  if (!id) throw new BadRequestError(`${tier} ${interval} price is not configured`);
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
  if (id && (id === proAnnual() || id === basicAnnual() || id === envPrice("STRIPE_PRICE_ANNUAL"))) {
    return "annual";
  }
  if (id && (id === proMonthly() || id === basicMonthly() || id === envPrice("STRIPE_PRICE_MONTHLY"))) {
    return "monthly";
  }
  const interval = typeof price === "string" ? null : price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return null;
}

function tierFromSubscription(sub: Stripe.Subscription): PaidTier {
  const price = sub.items.data[0]?.price;
  const id = typeof price === "string" ? null : price?.id;
  if (id && (id === basicMonthly() || id === basicAnnual())) return "basic";
  const meta = typeof sub.metadata?.tier === "string" ? sub.metadata.tier : null;
  if (meta === "basic") return "basic";
  return "pro";
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return {
    userId: row.user_id,
    status: row.status,
    plan: row.plan,
    tier: row.tier,
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
      "user_id,status,plan,tier,source,stripe_customer_id,stripe_subscription_id,current_period_end,trial_end,grandfather_until,cancel_at_period_end",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as EntitlementRow;
}

export async function hostedTier(userId: string): Promise<HostedTier> {
  if (!billingEnforced()) return "pro";
  const entitled = await isPro(userId);
  if (!entitled) return "free";
  const row = await getEntitlementRow(userId);
  if (row?.tier === "basic") return "basic";
  return "pro";
}

async function countPersonalNotes(userId: string): Promise<number> {
  const sb = serviceClient();
  const { count, error } = await sb
    .from("note_index")
    .select("path", { count: "exact", head: true })
    .eq("space_id", userId)
    .not("path", "like", "commitments/%");
  if (error) {
    console.error("[billing] note count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const enforced = billingEnforced();
  if (!enforced) {
    return {
      enforced: false,
      pro: true,
      paid: true,
      tier: "pro",
      usage: null,
      entitlement: null,
      upgradeUrl: upgradeUrl(),
    };
  }
  const row = await getEntitlementRow(userId);
  const tier = await hostedTier(userId);
  const notes = await countPersonalNotes(userId);
  return {
    enforced: true,
    pro: tier === "pro",
    paid: tier !== "free",
    tier,
    usage: { notes, limit: NOTE_LIMIT[tier] },
    entitlement: row ? toEntitlement(row) : null,
    upgradeUrl: upgradeUrl(),
  };
}

function paywall(
  message: string,
  suggestedTier: PaidTier,
  extras: PaymentRequiredError["extras"] = {},
): never {
  throw new PaymentRequiredError(message, upgradeUrl(), {
    code: extras.code ?? "payment_required",
    suggestedTier,
    ...extras,
  });
}

/** MCP tokens / agent connections — Basic or Pro. */
export async function requireBasic(userId: string, via?: string | null): Promise<void> {
  if (!billingEnforced()) return;
  if (via === "public") return;
  const tier = await hostedTier(userId);
  if (tier === "free") {
    paywall("Connecting an agent is on Basic. Start on the upgrade page.", "basic");
  }
}

/** Meetings, company wikis, semantic map — Pro only. */
export async function requirePro(userId: string, via?: string | null): Promise<void> {
  if (!billingEnforced()) return;
  if (via === "public") return;
  const tier = await hostedTier(userId);
  if (tier === "pro") return;
  paywall("Meetings and company wikis are on Pro. Start on the upgrade page.", "pro");
}

/** Cap on creating notes in a personal brain. Company spaces are Pro-gated at create. */
export async function requireNoteRoom(spaceId: string): Promise<void> {
  if (!billingEnforced()) return;
  const sb = serviceClient();
  const { data } = await sb.from("spaces").select("kind").eq("id", spaceId).maybeSingle();
  const kind = (data as { kind?: string } | null)?.kind;
  if (kind && kind !== "self") return;
  const userId = spaceId;
  const tier = await hostedTier(userId);
  const limit = NOTE_LIMIT[tier];
  if (limit == null) return;
  const used = await countPersonalNotes(userId);
  if (used >= limit) {
    const plan = tier === "free" ? "Free" : "Basic";
    paywall(`You used ${used} of ${limit} notes on ${plan}.`, tier === "free" ? "basic" : "pro", {
      code: "note_cap",
      used,
      limit,
    });
  }
}

async function upsertEntitlement(patch: {
  userId: string;
  status: EntitlementStatus;
  plan?: BillingPlan | null;
  tier?: PaidTier | null;
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
      tier: patch.tier ?? null,
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
  tier: PaidTier,
  interval: BillingPlan,
): Promise<{ url: string }> {
  if (!stripeConfigured()) throw new BadRequestError("billing is not configured");
  const customer = await ensureCustomer(userId);
  const web = upgradeUrl();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    allow_promotion_codes: true,
    line_items: [{ price: priceId(tier, interval), quantity: 1 }],
    success_url: `${web}?status=success`,
    cancel_url: `${web}?status=cancel`,
    metadata: { user_id: userId, tier },
    subscription_data: { metadata: { user_id: userId, tier } },
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
    tier: tierFromSubscription(sub),
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
        const tier = session.metadata?.tier === "basic" ? "basic" : "pro";
        await upsertEntitlement({
          userId,
          status: "active",
          tier,
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
