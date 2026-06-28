import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ohmyself!",
  description: "Your second brain — view it, search it, ask it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
