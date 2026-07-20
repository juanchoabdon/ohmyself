/** Time the real /v1/notes?prefix= endpoint through the public proxy. */
import "../env.js";
import { createToken } from "../core/index.js";

const SELF = "50e99419-6adb-45bf-9e49-9235c990444e";
const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";

async function timeIt(label: string, space: string, prefix: string, token: string): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://www.ohmyself.ai/v1/notes?prefix=${encodeURIComponent(prefix)}&limit=5000`,
      { headers: { Authorization: `Bearer ${token}`, "X-Brain-Space": space } },
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.log(label.padEnd(22), "HTTP", res.status, "in", ms, "ms");
      return;
    }
    const body = (await res.json()) as { notes: unknown[] };
    const bytes = JSON.stringify(body).length;
    console.log(
      label.padEnd(22),
      String(body.notes.length).padStart(4),
      "notes,",
      (bytes / 1024).toFixed(0).padStart(6),
      "KB in",
      ms,
      "ms",
    );
  } catch (e) {
    console.log(label.padEnd(22), "ERROR after", Date.now() - t0, "ms:", (e as Error).message.slice(0, 150));
  }
}

async function main(): Promise<void> {
  const { token } = await createToken(SELF, "diag-folder-timing", "secret");
  console.log("token minted (revoke after)");
  await timeIt("bonds people/", BONDS, "people/", token);
  await timeIt("bonds strategy/", BONDS, "strategy/", token);
  await timeIt("bonds finance/", BONDS, "finance/", token);
  await timeIt("self people/", SELF, "people/", token);
  await timeIt("self meetings/", SELF, "meetings/", token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
