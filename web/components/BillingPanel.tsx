"use client";

import { useState } from "react";
import { api, isPaymentRequired } from "@/lib/api";
import { PLANS, type BillingInterval, type HostedTier } from "@/lib/pricing";
import { IntervalToggle, PlanPicker } from "@/components/PlanPicker";
import { NoteUsageBar } from "@/components/NoteCap";
import type { BillingStatus } from "@/lib/types";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function planLabel(billing: BillingStatus): string {
  const name = PLANS[billing.tier].name;
  const ent = billing.entitlement;
  if (!ent) return name;
  if (ent.status === "grandfathered") return `${name} (early user)`;
  if (ent.status === "lifetime") return "Lifetime Pro";
  if (ent.status === "past_due") return `${name} — payment past due`;
  return name;
}

export function BillingPanel({
  token,
  billing,
  highlight,
}: {
  token: string;
  billing: BillingStatus;
  highlight?: "basic" | "pro";
}) {
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [busy, setBusy] = useState<"basic" | "pro" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ent = billing.entitlement;
  const until =
    formatDate(ent?.currentPeriodEnd) ??
    formatDate(ent?.trialEnd) ??
    formatDate(ent?.grandfatherUntil);
  const usage = billing.usage;
  const finite = usage && usage.limit != null;

  async function checkout(tier: "basic" | "pro") {
    setBusy(tier);
    setError(null);
    try {
      const { url } = await api.billingCheckout(token, tier, interval);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await api.billingPortal(token);
      window.location.href = url;
    } catch (e) {
      if (isPaymentRequired(e)) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Could not open billing portal");
      }
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-bg p-4">
        <p className="text-sm font-semibold text-ink">{planLabel(billing)}</p>
        {until && (
          <p className="mt-1 text-sm text-muted">
            {ent?.cancelAtPeriodEnd ? "Ends" : "Renews"} {until}
          </p>
        )}
        {finite && (
          <div className="mt-3">
            <NoteUsageBar used={usage.notes} limit={usage.limit!} planName={PLANS[billing.tier].name} />
          </div>
        )}
        {billing.paid && ent?.hasCustomer && (
          <button
            onClick={portal}
            disabled={busy !== null}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:text-brand-ink disabled:opacity-60"
          >
            {busy === "portal" ? "…" : "Manage billing"}
          </button>
        )}
      </div>

      {billing.tier !== "pro" && (
        <div className="space-y-3">
          <IntervalToggle value={interval} onChange={setInterval} />
          <PlanPicker
            interval={interval}
            currentTier={billing.tier}
            highlight={highlight ?? (billing.tier === "basic" ? "pro" : "basic")}
            busy={busy === "portal" ? null : busy}
            ctaLabel={(tier) =>
              billing.tier === tier ? "Current plan" : `Continue with ${PLANS[tier as HostedTier].name}`
            }
            onChoose={checkout}
          />
        </div>
      )}

      {error && <p className="text-sm text-vis-secret">{error}</p>}
    </div>
  );
}
