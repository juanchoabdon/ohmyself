/** Display catalog for hosted plans. Stripe price IDs live in env. */

export type HostedTier = "free" | "basic" | "pro";
export type BillingInterval = "monthly" | "annual";

export interface PlanCopy {
  id: HostedTier;
  name: string;
  notes: number | null;
  notesLabel: string;
  monthly: number;
  annual: number;
  blurb: string;
  includes: string[];
}

export const PLANS: Record<HostedTier, PlanCopy> = {
  free: {
    id: "free",
    name: "Free",
    notes: 100,
    notesLabel: "100 notes",
    monthly: 0,
    annual: 0,
    blurb: "Start here.",
    includes: ["Browse, edit, search", "Privacy levels", "Self-host anytime"],
  },
  basic: {
    id: "basic",
    name: "Basic",
    notes: 2_000,
    notesLabel: "2,000 notes",
    monthly: 10,
    annual: 100,
    blurb: "Your brain in Cursor, ChatGPT, Claude.",
    includes: ["Everything in Free", "Cursor, ChatGPT, Claude (MCP)"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    notes: null,
    notesLabel: "Unlimited notes",
    monthly: 20,
    annual: 200,
    blurb: "For heavy brains and teams.",
    includes: ["Everything in Basic", "Meetings and company wikis"],
  },
};

export const ANNUAL_SAVE = "2 months free";

export function formatNotes(n: number | null): string {
  if (n == null) return PLANS.pro.notesLabel;
  if (n === PLANS.free.notes) return PLANS.free.notesLabel;
  if (n === PLANS.basic.notes) return PLANS.basic.notesLabel;
  return `${n} notes`;
}

export function formatUsd(amount: number): string {
  return `$${amount}`;
}

export function priceFor(tier: Exclude<HostedTier, "free">, interval: BillingInterval): number {
  return interval === "annual" ? PLANS[tier].annual : PLANS[tier].monthly;
}

export function periodLabel(interval: BillingInterval): string {
  return interval === "annual" ? "/year" : "/month";
}

export function nextTier(tier: HostedTier): "basic" | "pro" | null {
  if (tier === "free") return "basic";
  if (tier === "basic") return "pro";
  return null;
}

export function capSentence(tier: HostedTier, used: number, limit: number): string {
  const plan = PLANS[tier].name;
  const next = nextTier(tier);
  const nextName = next ? PLANS[next].name : "Pro";
  const nextNotes = next ? PLANS[next].notesLabel.toLowerCase() : "unlimited notes";
  return `You used ${used} of ${limit} notes on ${plan}. Upgrade to ${nextName} (${nextNotes}) or delete some.`;
}

/** @deprecated use PLANS.basic / PLANS.pro — kept so older imports typecheck during the cutover */
export const PRICING = {
  monthly: { amount: PLANS.pro.monthly, label: formatUsd(PLANS.pro.monthly), period: "month" },
  annual: { amount: PLANS.pro.annual, label: formatUsd(PLANS.pro.annual), period: "year", save: ANNUAL_SAVE },
} as const;
