"use client";

import { useEffect } from "react";

/** Lock document scroll while the dashboard is mounted so only the
 *  in-app panes (sidebar / note) scroll — avoids the classic nested-flex
 *  "nothing scrolls" / dual-scrollbar fight with body. */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  return children;
}
