import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — ohmyself!",
  description: "How ohmyself! handles your data.",
};

const UPDATED = "June 28, 2026";
const SUPPORT = "support@ohmyself.ai";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <a href="/" className="font-display text-2xl font-semibold tracking-tight">
        <span className="brand-gradient">ohmyself!</span>
      </a>
      <h1 className="mt-8 text-2xl font-semibold text-ink">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

      <div className="prose-oms mt-8 space-y-6 text-[0.95rem] leading-relaxed text-ink">
        <Section title="What ohmyself! is">
          ohmyself! is a personal knowledge base — your &ldquo;second self.&rdquo; You create notes
          (identity, goals, projects, people, journal, skills, and more) stored as markdown files
          that belong to you. The service lets you, and AI agents you explicitly connect, read and
          update that content.
        </Section>

        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>Your account (email and authentication, via Supabase Auth).</li>
            <li>The notes you create, and a derived search index of them.</li>
            <li>Access tokens and OAuth grants you create to connect agents (stored only as hashes).</li>
            <li>Minimal operational metadata (timestamps, last-used times).</li>
          </ul>
          We do not sell your data, and we do not use your private notes to train models.
        </Section>

        <Section title="Privacy levels">
          Every note has a visibility: <strong>public</strong>, <strong>private</strong>, or{" "}
          <strong>secret</strong>. Notes are private by default. When you connect an agent (e.g.
          Claude or ChatGPT) you choose a scope, and the agent can only ever read or write notes at
          or below that scope. Public agents only ever see notes you explicitly mark public.
        </Section>

        <Section title="Connected agents (OAuth)">
          Connecting an MCP client uses OAuth 2.1: you log in and approve a specific access level on
          the consent screen. You can revoke any connection at any time from Settings. Revoking
          immediately invalidates that agent&rsquo;s tokens.
        </Section>

        <Section title="Data deletion">
          You can delete any note at any time. To delete your entire account and all associated
          data, email <a className="text-brand-ink underline" href={`mailto:${SUPPORT}`}>{SUPPORT}</a>{" "}
          and we will remove it.
        </Section>

        <Section title="Contact">
          Questions about privacy? Email{" "}
          <a className="text-brand-ink underline" href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 text-muted">{children}</div>
    </section>
  );
}
