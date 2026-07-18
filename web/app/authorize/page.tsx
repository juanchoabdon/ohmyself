"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiBase } from "@/lib/api";

type Scope = "public" | "private" | "secret";

const SCOPE_INFO: Record<Scope, { label: string; desc: string }> = {
  public: { label: "Public", desc: "Only what you've marked public. Safe for shared / public agents." },
  private: { label: "Private", desc: "Public + private notes. Your everyday personal agent." },
  secret: { label: "Everything", desc: "Public + private + secret. Full access, including sensitive notes." },
};

export default function AuthorizePage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <Authorize />
    </Suspense>
  );
}

function Authorize() {
  const params = useSearchParams();
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const state = params.get("state") ?? "";
  const responseType = params.get("response_type") ?? "code";

  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [scope, setScope] = useState<Scope>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = checking; true/false = server confirmed the redirect_uri is (not)
  // registered for this client. We never redirect to an unvalidated URI.
  const [redirectOk, setRedirectOk] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Validate (client_id, redirect_uri) server-side before showing consent or
  // ever redirecting — closes the open-redirect on deny.
  useEffect(() => {
    if (!clientId || !redirectUri) {
      setRedirectOk(false);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
    fetch(`${apiBase()}/oauth/authorize/validate?${qs.toString()}`)
      .then((r) => r.json())
      .then((j: { ok?: boolean }) => {
        if (!cancelled) setRedirectOk(j.ok === true);
      })
      .catch(() => {
        if (!cancelled) setRedirectOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, redirectUri]);

  const appHost = (() => {
    try {
      const h = new URL(redirectUri).hostname;
      if (h === "localhost" || h === "127.0.0.1") return "a local app (e.g. Claude Code)";
      return h;
    } catch {
      return "an application";
    }
  })();

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;
      if (!jwt) throw new Error("Please sign in first.");
      const res = await fetch(`${apiBase()}/oauth/authorize/grant`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          scope,
          state,
        }),
      });
      const json = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !json.redirect) throw new Error(json.error ?? "Could not authorize");
      window.location.href = json.redirect;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  function deny() {
    // Only redirect to a server-validated, registered redirect_uri.
    if (redirectOk !== true) {
      setError("Authorization denied.");
      return;
    }
    try {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch {
      setError("Authorization denied.");
    }
  }

  if (!ready || (clientId && redirectUri && redirectOk === null)) return <Centered>Loading…</Centered>;

  const missingParams =
    !clientId || !redirectUri || !codeChallenge || responseType !== "code";
  const redirectRejected = !missingParams && redirectOk === false;

  if (missingParams || redirectRejected) {
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-sm">
          <a href="/" className="font-display text-[1.6rem] font-semibold leading-none tracking-tight">
            <span className="brand-gradient">ohmyself!</span>
          </a>
          <h1 className="mt-6 text-lg font-semibold text-ink">Link de conexión incompleto</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {missingParams
              ? "Esta página solo funciona cuando una app (ChatGPT, Claude, Cursor…) abre el flujo de autorización con un link completo. Llegaste acá con parámetros faltantes — suele pasar por un bookmark, un retry en loop, o Safari en iPhone que pierde parte de la URL."
              : "La app que intenta conectar no pasó la validación de seguridad (redirect no registrado)."}
          </p>
          <div className="mt-5 space-y-2 rounded-xl border border-border bg-bg p-4 text-sm text-ink">
            <p className="font-medium">Qué hacer:</p>
            <ol className="list-decimal space-y-1.5 pl-4 text-muted">
              <li>
                <strong className="font-medium text-ink">Cierra esta pestaña</strong> — no va a
                arreglarse sola.
              </li>
              <li>
                Si conectaste ohmyself en <strong className="text-ink">ChatGPT o Claude</strong>:
                quita el connector y vuelve a agregarlo desde la app (mejor en desktop).
              </li>
              <li>
                Si solo quieres <strong className="text-ink">Google Drive / meetings</strong>: entra
                a la app web → Settings → Connect Google. No necesitas esta página.
              </li>
              <li>Borra cualquier bookmark a <code className="text-xs">/authorize</code>.</li>
            </ol>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <a
              href="/app"
              className="rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-medium text-white hover:opacity-95"
            >
              Ir a ohmyself (app web)
            </a>
            <a
              href="/"
              className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium text-ink hover:bg-bg"
            >
              Volver al inicio
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-sm">
        <a href="/" className="font-display text-[1.6rem] font-semibold leading-none tracking-tight">
          <span className="brand-gradient">ohmyself!</span>
        </a>

        {!authed ? (
          <>
            <h1 className="mt-6 text-lg font-semibold text-ink">Sign in to continue</h1>
            <p className="mt-1 text-sm text-muted">
              <span className="font-medium text-ink">{appHost}</span> wants to connect to your second self.
            </p>
            <InlineAuth onError={setError} />
            {error && <p className="mt-3 text-sm text-vis-secret">{error}</p>}
          </>
        ) : (
          <>
            <h1 className="mt-6 text-lg font-semibold text-ink">Connect your second self</h1>
            <p className="mt-1 text-sm text-muted">
              <span className="font-medium text-ink">{appHost}</span> is requesting access to ohmyself!.
              Choose how much it can see.
            </p>

            <div className="mt-5 space-y-2">
              {(Object.keys(SCOPE_INFO) as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                    scope === s ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                      scope === s ? "border-brand" : "border-border"
                    }`}
                  >
                    {scope === s && <span className="h-2 w-2 rounded-full bg-brand" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-ink">{SCOPE_INFO[s].label}</span>
                    <span className="block text-xs leading-relaxed text-muted">{SCOPE_INFO[s].desc}</span>
                  </span>
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-sm text-vis-secret">{error}</p>}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={deny}
                disabled={busy}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg disabled:opacity-60"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
              >
                {busy ? "…" : "Allow"}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-muted">
              You can revoke access anytime from Settings.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function InlineAuth({ onError }: { onError: (e: string | null) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          onError("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <input
        className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[0.95rem] text-ink placeholder:text-muted/70 focus:border-brand"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        required
      />
      <input
        className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[0.95rem] text-ink placeholder:text-muted/70 focus:border-brand"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        required
      />
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
      >
        {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="w-full text-center text-xs text-muted hover:text-ink"
      >
        {mode === "signin" ? "Need an account? Create one" : "Have an account? Sign in"}
      </button>
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center px-5 text-sm text-muted">{children}</main>;
}
