import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade — ohmyself!",
  description: "ohmyself! Pro — connect agents, company wikis, and deep research on the hosted product.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
