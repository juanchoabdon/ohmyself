import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — ohmyself!",
  description: "Terms for using ohmyself!.",
};

const UPDATED = "June 28, 2026";
const SUPPORT = "support@ohmyself.ai";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <a href="/" className="font-display text-2xl font-semibold tracking-tight">
        <span className="brand-gradient">ohmyself!</span>
      </a>
      <h1 className="mt-8 text-2xl font-semibold text-ink">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

      <div className="mt-8 space-y-6 text-[0.95rem] leading-relaxed text-ink">
        <Section title="Acceptance">
          By creating an account or connecting an agent to ohmyself!, you agree to these terms.
        </Section>
        <Section title="Your content">
          You own the content you create. You are responsible for what you store and for the agents
          you connect. Do not store content you do not have the right to store, and do not use the
          service for unlawful purposes.
        </Section>
        <Section title="Connected agents">
          You control which agents connect and at what access level. You are responsible for the
          third-party clients (such as Claude or ChatGPT) you authorize and their handling of data
          you choose to share with them.
        </Section>
        <Section title="Availability & changes">
          The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis,
          without warranties of any kind. We may update or discontinue features, and we may update
          these terms; continued use means you accept the changes.
        </Section>
        <Section title="Limitation of liability">
          To the maximum extent permitted by law, ohmyself! is not liable for any indirect,
          incidental, or consequential damages arising from your use of the service.
        </Section>
        <Section title="Contact">
          Questions? Email{" "}
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
