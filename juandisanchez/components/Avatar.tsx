"use client";

import { useState } from "react";

/**
 * The persona avatar. Tries to load /me.jpg (drop your photo in public/),
 * and gracefully falls back to an initials medallion so the site looks
 * finished even before a photo is added.
 */
export function Avatar({
  size = 44,
  initials = "JD",
  src = "/me.png",
  glow = false,
}: {
  size?: number;
  initials?: string;
  src?: string;
  glow?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(140deg, var(--accent-lime), var(--brand) 55%, var(--accent-teal))",
        boxShadow: glow
          ? "0 0 0 1px var(--border), 0 8px 30px -8px color-mix(in oklch, var(--brand) 60%, transparent)"
          : "0 0 0 1px var(--border)",
      }}
    >
      {failed ? (
        <span
          className="font-heading font-semibold text-white"
          style={{ fontSize: size * 0.38, letterSpacing: "-0.02em" }}
        >
          {initials}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
