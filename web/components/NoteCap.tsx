"use client";

import Link from "next/link";
import { ANNUAL_SAVE, PLANS, capSentence, formatUsd, nextTier, type HostedTier } from "@/lib/pricing";

export function NoteCapMessage({
  tier,
  used,
  limit,
  onDismiss,
}: {
  tier: HostedTier;
  used: number;
  limit: number;
  onDismiss?: () => void;
}) {
  const next = nextTier(tier) ?? "basic";
  const plan = PLANS[next];

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink">{capSentence(tier, used, limit)}</p>
      <div className="flex flex-col gap-2">
        <Link
          href={`/upgrade?from=${next}`}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:opacity-95"
        >
          Continue with {plan.name} — {formatUsd(plan.monthly)}/month
        </Link>
        <p className="text-center text-xs text-muted">
          or {formatUsd(plan.annual)}/year — {ANNUAL_SAVE}
        </p>
        {next === "basic" && (
          <Link href="/upgrade?from=pro" className="text-center text-sm font-medium text-brand-ink hover:underline">
            See Pro
          </Link>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-center text-sm font-medium text-muted hover:text-ink"
          >
            I&apos;ll delete some notes
          </button>
        )}
      </div>
    </div>
  );
}

export function NoteUsageBar({
  used,
  limit,
  planName,
}: {
  used: number;
  limit: number;
  planName: string;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tight = pct >= 80;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={tight ? "font-medium text-ink" : "text-muted"}>
          {used.toLocaleString("en-US")} / {limit.toLocaleString("en-US")} notes
        </span>
        <span className="text-muted">{planName}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label="Notes used"
      >
        <div
          className={`h-full rounded-full ${tight ? "bg-vis-secret" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
