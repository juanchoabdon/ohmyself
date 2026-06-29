import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const PERSON = process.env.PERSON_NAME ?? "Juan Diego Sánchez";

export const metadata: Metadata = {
  metadataBase: new URL("https://juandisanchez.com"),
  title: `${PERSON} — ask my second self`,
  description: `Chat with ${PERSON}'s second self — ask anything about who he is, what he's built, and where he's been. Answers come from what he's chosen to share publicly.`,
  openGraph: {
    title: `${PERSON} — ask my second self`,
    description: `Chat with ${PERSON}'s second self. Ask anything.`,
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#2a2320",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-[100dvh] font-sans antialiased">
        <div aria-hidden className="ambient" />
        {children}
      </body>
    </html>
  );
}
