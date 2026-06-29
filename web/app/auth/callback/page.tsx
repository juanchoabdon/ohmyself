"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Dedicated OAuth landing route. Supabase redirects here after Google sign-in
 * with the session in the URL (hash for the implicit flow, `?code=` for PKCE).
 * We wait for the client to establish the session, then forward to /app. If the
 * provider returned an error we show it instead of silently bouncing to /login.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const urlError =
      hash.get("error_description") ||
      query.get("error_description") ||
      hash.get("error") ||
      query.get("error");

    if (urlError) {
      setError(decodeURIComponent(urlError));
      return;
    }

    function done(session: unknown) {
      if (!active || !session) return false;
      router.replace("/app");
      return true;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      done(session);
    });

    (async () => {
      // If a PKCE code is present and detectSessionInUrl hasn't consumed it yet,
      // exchange it explicitly. Harmless no-op for the implicit (hash) flow.
      const code = query.get("code");
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(window.location.href);
        } catch {
          /* detectSessionInUrl may have already handled it */
        }
      }

      const { data } = await supabase.auth.getSession();
      if (done(data.session)) return;

      // Last resort: give onAuthStateChange a moment, then fall back to login.
      setTimeout(() => {
        if (!active) return;
        supabase.auth.getSession().then(({ data: d }) => {
          if (!active) return;
          if (!done(d.session)) {
            router.replace("/login?error=" + encodeURIComponent("Could not complete sign-in. Please try again."));
          }
        });
      }, 1500);
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 font-display text-[1.9rem] font-semibold leading-none tracking-tight">
          <span className="brand-gradient">ohmyself!</span>
        </div>
        {error ? (
          <>
            <p className="text-sm text-vis-secret">{error}</p>
            <a
              href="/login"
              className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
            Signing you in…
          </p>
        )}
      </div>
    </main>
  );
}
