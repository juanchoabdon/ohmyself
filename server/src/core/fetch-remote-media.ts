import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BadRequestError } from "./errors.js";

/**
 * Download media an agent pointed us at.
 *
 * An agent can hand us any URL, so this is a server-side request forgery vector
 * by construction: without checks it would happily fetch cloud metadata
 * endpoints or services on the private network and hand the body back to the
 * caller. Every hop is resolved and screened before it is followed.
 *
 * Residual risk: DNS can rebind between our lookup and the connection. Closing
 * that needs a custom connect hook that re-checks the peer address; the screen
 * below is the practical mitigation and keeps the obvious paths shut.
 */

const MAX_REDIRECTS = 3;

/** Ranges that never host a legitimate public asset. */
function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (v === 6) {
    const ipv6 = ip.toLowerCase();
    if (ipv6 === "::" || ipv6 === "::1") return true;
    // An IPv4-mapped address must be screened as the IPv4 it really is. WHATWG
    // URL parsing rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, so both the
    // dotted and the hex form have to be recognized.
    const mapped = /^::ffff:(.+)$/.exec(ipv6);
    if (mapped) {
      const rest = mapped[1]!;
      if (isIP(rest) === 4) return isBlockedAddress(rest);
      const groups = rest.split(":");
      if (groups.length === 2) {
        const hi = Number.parseInt(groups[0]!, 16);
        const lo = Number.parseInt(groups[1]!, 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
        }
      }
      return true; // an embedded-IPv4 form we can't read is not worth allowing
    }
    if (ipv6.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(ipv6)) return true; // unique-local
    if (ipv6.startsWith("ff")) return true; // multicast
    return false;
  }
  return true;
}

async function assertPublicHost(rawHost: string): Promise<void> {
  // URL.hostname keeps the brackets around an IPv6 literal; isIP rejects those.
  const hostname =
    rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new BadRequestError("that address is not reachable from here");
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BadRequestError(`could not resolve ${hostname}`);
  }
  if (addresses.length === 0) throw new BadRequestError(`could not resolve ${hostname}`);
  // Any private answer disqualifies the host — a split-horizon name that
  // resolves to both is exactly the case worth refusing.
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new BadRequestError("that address is not reachable from here");
  }
}

export interface RemoteMedia {
  bytes: Uint8Array;
  mime: string;
  filename: string | null;
}

/**
 * Fetch `rawUrl` and return its bytes, refusing anything bigger than
 * `maxBytes`. Redirects are followed manually so each hop gets screened.
 */
export async function fetchRemoteMedia(rawUrl: string, maxBytes: number): Promise<RemoteMedia> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError("source_url is not a valid URL");
  }

  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new BadRequestError("source_url must be http or https");
    }
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "image/*,video/*" },
    }).catch(() => {
      throw new BadRequestError(`could not download ${url.hostname}`);
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new BadRequestError("source_url redirected without a target");
      if (hop >= MAX_REDIRECTS) throw new BadRequestError("source_url redirected too many times");
      url = new URL(location, url);
      continue;
    }

    if (!res.ok) throw new BadRequestError(`source_url returned ${res.status}`);

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new BadRequestError("that file is too large to store");
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new BadRequestError("that file is too large to store");

    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "") || null;
    return { bytes: new Uint8Array(buffer), mime, filename };
  }
}
