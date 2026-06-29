import { Brain } from "./brain.js";
import { getUserConfig, setUserConfig } from "./config-store.js";
import { FsIndex } from "./indexer/fs.js";
import { SupabaseIndex } from "./indexer/supabase.js";
import type { BrainIndex } from "./indexer/types.js";
import { FsVault } from "./vault/fs.js";
import { SupabaseVault } from "./vault/supabase.js";
import type { Vault } from "./vault/types.js";

export * from "./types.js";
export * from "./scope.js";
export * from "./config.js";
export * from "./errors.js";
export { Brain, slugify } from "./brain.js";
export { parseNote, serializeNote, todayISO, excerptOf } from "./frontmatter.js";
export { getUserConfig, setUserConfig, getDisplayName } from "./config-store.js";
export { createToken, listTokens, revokeToken, lookupToken } from "./tokens.js";
export type { ApiTokenRow } from "./tokens.js";
export {
  registerClient,
  getClient,
  createAuthCode,
  consumeAuthCode,
  issueTokens,
  lookupAccessToken,
  refreshTokens,
} from "./oauth.js";
export type { OAuthClient, RegisterClientInput, IssuedTokens } from "./oauth.js";

export interface OhmyselfCore {
  brain: Brain;
  vault: Vault;
  backend: "supabase" | "fs";
  getConfig: typeof getUserConfig;
  setConfig: typeof setUserConfig;
}

let _core: OhmyselfCore | null = null;

export function buildCore(): OhmyselfCore {
  if (_core) return _core;
  const backend = (process.env.VAULT_BACKEND ?? "supabase") === "fs" ? "fs" : "supabase";
  let vault: Vault;
  let index: BrainIndex;
  if (backend === "fs") {
    vault = new FsVault(process.env.FS_VAULT_DIR ?? "./vault");
    index = new FsIndex(vault);
  } else {
    vault = new SupabaseVault();
    index = new SupabaseIndex();
  }
  _core = {
    brain: new Brain(vault, index),
    vault,
    backend,
    getConfig: getUserConfig,
    setConfig: setUserConfig,
  };
  return _core;
}
