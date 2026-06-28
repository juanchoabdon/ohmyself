import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load env from the repo root: .env.local takes precedence over .env.
// Importing this module for its side effect is enough.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

config({ path: path.join(repoRoot, ".env.local") });
config({ path: path.join(repoRoot, ".env") });
