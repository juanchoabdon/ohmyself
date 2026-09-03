"use client";

import { useState } from "react";
import { api, isPaymentRequired } from "@/lib/api";
import { PRICING } from "@/lib/pricing";
import type { BillingStatus, EntitlementStatus } from "@/lib/types";

const STATUS_COPY: Record<EntitlementStatus, string> = {
  free: "Free",
  trialing: "Trial",
  active: "Pro",
  past_due: "Payment past due",
  canceled: "Canceled",
  grandfathered: "Pro (early user)",
  lifetime: "Lifetime Pro",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function BillingPanel({
  token,
  billing,
}: {
  token: string;
  billing: BillingStatus;
  onUpdated?: () => void;
}) {
  const [busy, setBusy] = useState<"monthly" | "annual" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ent = billing.entitlement;
  const label = ent ? STATUS_COPY[ent.status] : billing.pro ? "Pro" : "Free";
  const until =
    formatDate(ent?.currentPeriodEnd) ??
    formatDate(ent?.trialEnd) ??
    formatDate(ent?.grandfatherUntil);

  async function checkout(plan: "monthly" | "annual") {
    setBusy(plan);
    setError(null);
    try {
      const { url } = await api.billingCheckout(token, plan);
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
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Plan</p>
        <p className="mt-1 text-lg font-semibold text-ink">{label}</p>
        {until && (
          <p className="mt-1 text-sm text-muted">
            {ent?.cancelAtPeriodEnd ? "Ends" : "Renews"} {until}
          </p>
        )}
        {billing.pro && ent?.hasCustomer && (
          <button
            onClick={portal}
            disabled={busy !== null}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:text-brand-ink disabled:opacity-60"
          >
            {busy === "portal" ? "…" : "Manage billing"}
          </button>
        )}
      </div>

      {!billing.pro && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PlanCard
            name="Monthly"
            price={PRICING.monthly.label}
            period={`/${PRICING.monthly.period}`}
            cta={busy === "monthly" ? "…" : "Subscribe monthly"}
            busy={busy !== null}
            onClick={() => checkout("monthly")}
          />
          <PlanCard
            name="Annual"
            price={PRICING.annual.label}
            period={`/${PRICING.annual.period}`}
            note={PRICING.annual.save}
            recommended
            cta={busy === "annual" ? "…" : "Subscribe annually"}
            busy={busy !== null}
            onClick={() => checkout("annual")}
          />
        </div>
      )}

      {error && <p className="text-sm text-vis-secret">{error}</p>}
    </div>
  );
}

function PlanCard({
  name,
  price,
  period,
  note,
  recommended,
  cta,
  busy,
  onClick,
}: {
  name: string;
  price: string;
  period: string;
  note?: string;
  recommended?: boolean;
  cta: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        recommended ? "border-brand bg-brand-weak/40" : "border-border bg-bg"
      }`}
    >
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {price}
        <span className="text-sm font-medium text-muted">{period}</span>
      </p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <button
        onClick={onClick}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
      >
        {cta}
      </button>
    </div>
  );
}
