"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signin" ? "signin" : "signup",
  );

  // If a session already exists — or one just landed here from the Google OAuth
  // redirect — forward straight to the app instead of showing the form again.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace("/app");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) router.replace("/app");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => params.get("error"));

  async function google() {
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // On success the browser is redirected to Google; nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name || email.split("@")[0] } },
        });
        if (error) throw error;
        if (!data.session) {
          setError("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <a href="/" className="font-display text-[1.9rem] font-semibold leading-none tracking-tight">
            <span className="brand-gradient">ohmyself!</span>
          </a>
          <p className="mt-2 text-[0.95rem] text-muted">
            Your second self — view it, search it, ask it.
          </p>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          {(["signup", "signin"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 transition-colors duration-150 ${
                mode === m ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {m === "signup" ? "Create account" : "Sign in"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={google}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-2.5 text-[0.95rem] font-medium text-ink shadow-sm transition-colors duration-150 hover:border-brand hover:text-brand-ink disabled:opacity-60"
        >
          <GoogleMark />
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          or {mode === "signup" ? "sign up" : "sign in"} with email
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <Field
              label="Name"
              value={name}
              onChange={setName}
              type="text"
              placeholder="Juan Diego"
              autoComplete="name"
            />
          )}
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="••••••••"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />

          {error && (
            <p className="rounded-md bg-vis-secret/10 px-3 py-2 text-sm text-vis-secret">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition-opacity duration-150 hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-muted">
          New accounts get a starter second self seeded automatically. Notes are private
          by default; you choose what becomes public.
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{props.label}</span>
      <input
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-[0.95rem] text-ink placeholder:text-muted/70 focus:border-brand"
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        required={props.required}
      />
    </label>
  );
}
