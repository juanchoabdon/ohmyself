/**
 * Smoke test for the agent-facing media path. Covers the two pieces that can
 * fail quietly: the SSRF screen on source_url, and the downscale that keeps a
 * base64 image small enough to hand a model. No Supabase or network needed.
 *
 *   npx tsx src/scripts/test-media-agent.ts
 */
import sharp from "sharp";
import { fetchRemoteMedia } from "../core/fetch-remote-media.js";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** A refusal must come from the screen itself. "could not resolve" would mean
 *  we got lucky with DNS rather than actually recognizing the address. */
async function refuses(name: string, url: string, expect = /not reachable from here/) {
  try {
    await fetchRemoteMedia(url, 1024);
    check(name, false, "was allowed through");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, expect.test(msg), msg);
  }
}

async function main() {
  console.log("— SSRF screen —");
  await refuses("blocks cloud metadata", "http://169.254.169.254/latest/meta-data/");
  await refuses("blocks loopback", "http://127.0.0.1:8080/secret");
  await refuses("blocks localhost by name", "http://localhost:3000/secret");
  await refuses("blocks private 10/8", "http://10.0.0.5/internal");
  await refuses("blocks private 192.168/16", "https://192.168.1.1/admin");
  await refuses("blocks private 172.16/12", "http://172.20.0.1/");
  await refuses("blocks IPv6 loopback", "http://[::1]/");
  await refuses("blocks IPv6 unique-local", "http://[fd00::1]/");
  await refuses("blocks IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/");
  await refuses("blocks IPv6 link-local", "http://[fe80::1]/");
  await refuses("blocks file scheme", "file:///etc/passwd", /must be http or https/);
  await refuses("blocks gopher scheme", "gopher://example.com/", /must be http or https/);
  await refuses("blocks garbage", "not a url", /not a valid URL/);

  console.log("\n— downscale for vision —");
  const huge = await sharp({
    create: { width: 4000, height: 2500, channels: 3, background: { r: 20, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();

  const rendered = await sharp(huge)
    .rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const meta = await sharp(rendered).metadata();

  check("longest edge capped at 1568", meta.width === 1568, `${meta.width}x${meta.height}`);
  check("aspect ratio preserved", meta.height === 980, `height ${meta.height}`);
  check("output is webp", meta.format === "webp", String(meta.format));
  check(
    "base64 payload stays small",
    Buffer.from(rendered).toString("base64").length < 400_000,
    `${Math.round(Buffer.from(rendered).toString("base64").length / 1024)} KB of base64 (was ${Math.round(huge.byteLength / 1024)} KB raw)`,
  );

  const small = await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const smallOut = await sharp(small)
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .webp()
    .toBuffer();
  const smallMeta = await sharp(smallOut).metadata();
  check("small images are not upscaled", smallMeta.width === 320, `${smallMeta.width}px`);

  console.log(failures === 0 ? "\nall good" : `\n${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
