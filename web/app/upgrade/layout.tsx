import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade — ohmyself!",
  description: "Free, Basic, or Pro — one number: notes. Connect agents on Basic. Meetings and wikis on Pro.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
