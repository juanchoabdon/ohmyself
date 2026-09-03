"use client";

import { Check, Minus } from "lucide-react";
import {
  ANNUAL_SAVE,
  PLANS,
  formatUsd,
  periodLabel,
  type BillingInterval,
  type HostedTier,
} from "@/lib/pricing";

const COMPARISON = [
  { id: "web", label: "Brain on the web", free: true, basic: true, pro: true },
  { id: "apps", label: "Cursor, ChatGPT, Claude", free: false, basic: true, pro: true },
  { id: "team", label: "Meetings and company wikis", free: false, basic: false, pro: true },
] as const;

const ORDER: HostedTier[] = ["free", "basic", "pro"];

export function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-brand-weak p-0.5">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          value === "monthly" ? "bg-surface text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          value === "annual" ? "bg-surface text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Yearly
        <span className="ml-1.5 text-xs text-brand-ink">{ANNUAL_SAVE}</span>
      </button>
    </div>
  );
}

function FeatureRow({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={`flex items-start gap-2.5 text-sm leading-snug ${on ? "text-ink" : "text-muted"}`}>
      {on ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" strokeWidth={2.25} aria-hidden />
      ) : (
        <Minus className="mt-0.5 h-4 w-4 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
      )}
      <span>
        {label}
        <span className="sr-only">{on ? " included" : " not included"}</span>
      </span>
    </li>
  );
}

export function PlanPicker({
  interval,
  currentTier,
  highlight,
  busy,
  ctaLabel,
  onChoose,
}: {
  interval: BillingInterval;
  currentTier?: HostedTier;
  highlight?: "basic" | "pro";
  busy?: "basic" | "pro" | null;
  ctaLabel?: (tier: "basic" | "pro") => string;
  onChoose?: (tier: "basic" | "pro") => void;
}) {
  const recommended = highlight ?? "basic";

  return (
    <div className="grid items-stretch gap-3 md:grid-cols-3">
      {ORDER.map((id) => {
        const plan = PLANS[id];
        const featured = id === recommended;
        const mine = currentTier === id;
        const paid = id === "basic" || id === "pro";
        const price = paid ? (interval === "annual" ? plan.annual : plan.monthly) : 0;
        const label = paid
          ? (ctaLabel?.(id) ?? (mine ? "Your plan" : `Continue with ${plan.name}`))
          : mine
            ? "Your plan"
            : null;

        return (
          <article
            key={id}
            className={`flex flex-col rounded-2xl border p-5 md:p-6 ${
              featured ? "border-brand bg-brand-weak/50" : "border-border bg-surface"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{plan.name}</h3>
              {featured && <p className="text-xs font-medium text-brand-ink">Recommended</p>}
              {mine && !featured && <p className="text-xs font-medium text-muted">Current</p>}
            </div>

            <p className="mt-3 font-heading text-3xl font-bold tracking-tight text-ink">
              {paid ? formatUsd(price) : "$0"}
              {paid && (
                <span className="text-base font-medium text-muted">{periodLabel(interval)}</span>
              )}
            </p>
            {paid && interval === "annual" && (
              <p className="mt-1 text-xs text-muted">
                {formatUsd(plan.monthly)}/mo billed yearly
              </p>
            )}
            {!paid && <p className="mt-1 text-xs text-muted">No credit card</p>}

            <p className="mt-4 font-heading text-xl font-semibold tracking-tight text-ink">
              {plan.notesLabel}
            </p>
            <p className="mt-1 text-sm text-muted">{plan.blurb}</p>

            <ul className="mt-5 flex flex-1 flex-col gap-2.5">
              {COMPARISON.map((row) => (
                <FeatureRow key={row.id} on={row[id]} label={row.label} />
              ))}
            </ul>

            <div className="mt-6">
              {paid && onChoose ? (
                <button
                  type="button"
                  disabled={busy != null || mine}
                  onClick={() => onChoose(id)}
                  className="w-full rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
                >
                  {busy === id ? "…" : label}
                </button>
              ) : (
                <p className="py-2.5 text-center text-sm text-muted">{label ?? "\u00a0"}</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
