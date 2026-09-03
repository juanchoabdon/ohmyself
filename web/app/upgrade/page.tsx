"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { api } from "@/lib/api";
import { ANNUAL_SAVE, PLANS } from "@/lib/pricing";
import type { BillingInterval } from "@/lib/pricing";
import { BillingPanel } from "@/components/BillingPanel";
import { IntervalToggle, PlanPicker } from "@/components/PlanPicker";
import { NoteCapMessage } from "@/components/NoteCap";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { BillingStatus } from "@/lib/types";

export default function UpgradePage() {
  return (
    <Suspense fallback={<p className="px-5 py-16 text-sm text-muted">Loading…</p>}>
      <Upgrade />
    </Suspense>
  );
}

function Upgrade() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status");
  const from = params.get("from") === "pro" ? "pro" : "basic";
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [token, setToken] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase.auth.getSession();
      const access = data.session?.access_token ?? null;
      if (!active) return;
      setToken(access);
      if (!access) {
        setBilling(null);
        return;
      }
      try {
        const b = await api.billingStatus(access);
        if (active) setBilling(b);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load billing");
      }
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [status]);

  return (
    <main className="mx-auto max-w-5xl px-5 py-16">
      <div className="flex items-center justify-between">
        <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
          <span className="brand-gradient">ohmyself!</span>
        </Link>
        <ThemeToggle />
      </div>

      <h1 className="mt-10 font-heading text-3xl font-bold tracking-tight text-ink">
        Free, Basic, or Pro.
      </h1>
      <p className="mt-2 max-w-xl text-pretty text-muted">
        One number: notes. Yearly is {ANNUAL_SAVE}. Self-hosting the open-source server stays free.
      </p>

      {status === "success" && (
        <p className="mt-4 rounded-xl border border-border bg-brand-weak/50 px-4 py-3 text-sm text-ink">
          Payment received. Your plan updates as soon as Stripe confirms — usually a few seconds.
        </p>
      )}
      {status === "cancel" && (
        <p className="mt-4 rounded-xl border border-border bg-bg px-4 py-3 text-sm text-muted">
          Checkout canceled. Nothing was charged.
        </p>
      )}

      <div className="mt-8">
        {!token && (
          <div className="space-y-4">
            <IntervalToggle value={interval} onChange={setInterval} />
            <PlanPicker
              interval={interval}
              highlight={from}
              onChoose={(tier) => {
                router.push(`/login?mode=signin&next=${encodeURIComponent(`/upgrade?from=${tier}`)}`);
              }}
            />
            <Link
              href={`/login?mode=signin&next=${encodeURIComponent(`/upgrade?from=${from}`)}`}
              className="inline-flex rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95"
            >
              Sign in to subscribe
            </Link>
          </div>
        )}
        {token && billing && billing.enforced && (
          <BillingPanel token={token} billing={billing} highlight={from} />
        )}
        {token && billing && !billing.enforced && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Charging is off on this server. This is the checkout as users will see it.
            </p>
            <IntervalToggle value={interval} onChange={setInterval} />
            <PlanPicker interval={interval} highlight={from} />
          </div>
        )}
        {token && !billing && !error && <p className="text-sm text-muted">Loading your plan…</p>}
        {error && <p className="text-sm text-vis-secret">{error}</p>}
      </div>

      <section className="mt-14 max-w-md">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-ink">If you hit 100 notes</h2>
        <p className="mt-1 text-sm text-muted">Same message as in the app. No extra meters.</p>
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <NoteCapMessage tier="free" used={PLANS.free.notes!} limit={PLANS.free.notes!} />
        </div>
      </section>
    </main>
  );
}
