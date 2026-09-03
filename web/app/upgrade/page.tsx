"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { api } from "@/lib/api";
import { PRICING } from "@/lib/pricing";
import { BillingPanel } from "@/components/BillingPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { BillingStatus } from "@/lib/types";

export default function UpgradePage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <Upgrade />
    </Suspense>
  );
}

function Upgrade() {
  const params = useSearchParams();
  const status = params.get("status");
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
    <main className="mx-auto max-w-2xl px-5 py-16">
      <div className="flex items-center justify-between">
        <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
          <span className="brand-gradient">ohmyself!</span>
        </Link>
        <ThemeToggle />
      </div>

      <h1 className="mt-10 font-heading text-3xl font-bold tracking-tight text-ink">Pro</h1>
      <p className="mt-2 text-pretty text-muted">
        The hosted brain stays yours as markdown. Pro connects agents, company wikis, meetings, and
        deep research on ohmyself.ai. Self-hosting the open source server stays free.
      </p>

      {status === "success" && (
        <p className="mt-4 rounded-xl border border-border bg-brand-weak/50 px-4 py-3 text-sm text-ink">
          Payment received. Pro unlocks as soon as Stripe confirms — usually a few seconds.
        </p>
      )}
      {status === "cancel" && (
        <p className="mt-4 rounded-xl border border-border bg-bg px-4 py-3 text-sm text-muted">
          Checkout canceled. Nothing was charged.
        </p>
      )}

      <ul className="mt-8 space-y-2 text-sm text-ink">
        <li>Connect Claude, ChatGPT, Cursor, and any MCP client</li>
        <li>Company wikis with roles</li>
        <li>Calendar connectors and meeting distill</li>
        <li>Deep research and the semantic brain map</li>
      </ul>

      <div className="mt-8">
        {!token && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <SilentPlan name="Monthly" price={PRICING.monthly.label} period={`/${PRICING.monthly.period}`} />
              <SilentPlan
                name="Annual"
                price={PRICING.annual.label}
                period={`/${PRICING.annual.period}`}
                note={PRICING.annual.save}
                recommended
              />
            </div>
            <Link
              href="/login?mode=signin&next=/upgrade"
              className="inline-flex rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95"
            >
              Sign in to subscribe
            </Link>
          </div>
        )}
        {token && billing && <BillingPanel token={token} billing={billing} />}
        {token && !billing && !error && <p className="text-sm text-muted">Loading your plan…</p>}
        {error && <p className="text-sm text-vis-secret">{error}</p>}
      </div>

      <p className="mt-10 text-xs text-muted">
        Self-host with <code className="font-mono">VAULT_BACKEND=fs</code> or leave{" "}
        <code className="font-mono">OMS_ENFORCE_PRO</code> unset — billing never applies.
      </p>
    </main>
  );
}

function SilentPlan({
  name,
  price,
  period,
  note,
  recommended,
}: {
  name: string;
  price: string;
  period: string;
  note?: string;
  recommended?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        recommended ? "border-brand bg-brand-weak/40" : "border-border bg-surface"
      }`}
    >
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {price}
        <span className="text-sm font-medium text-muted">{period}</span>
      </p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-16 text-sm text-muted">{children}</p>;
}
