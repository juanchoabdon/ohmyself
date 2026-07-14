import { Brain } from "./brain.js";
import { getUserConfig, setUserConfig } from "./config-store.js";
import { FsIndex } from "./indexer/fs.js";
import { SupabaseIndex } from "./indexer/supabase.js";
import type { BrainIndex } from "./indexer/types.js";
import { FsVault } from "./vault/fs.js";
import { SupabaseVault } from "./vault/supabase.js";
import type { Vault } from "./vault/types.js";
import { FsVersionStore } from "./versions/fs.js";
import { NoopVersionStore } from "./versions/noop.js";
import { SupabaseVersionStore } from "./versions/supabase.js";
import type { VersionStore } from "./versions/types.js";

export * from "./types.js";
export * from "./scope.js";
export * from "./authz.js";
export * from "./config.js";
export * from "./errors.js";
export { emitBrainEvent, subscribeBrainEvents, type BrainEvent, type BrainEventType } from "./events.js";
export { Brain, slugify } from "./brain.js";
export { parseNote, serializeNote, todayISO, excerptOf } from "./frontmatter.js";
export {
  getUserConfig,
  setUserConfig,
  getDisplayName,
  getSpaceConfig,
  setSpaceConfig,
  seedSpaceConfig,
} from "./config-store.js";
export {
  getSpace,
  resolveRole,
  listSpacesForUser,
  createCompanySpace,
  updateSpace,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from "./spaces.js";
export type { Space, SpaceKind, CreateSpaceInput, UpdateSpaceInput, SpaceMember } from "./spaces.js";
export { serviceClient, brainBucket, logoBucket } from "./supabase.js";
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
export {
  shareWith,
  listSharedByMe,
  listSharedWithMe,
  revokeShare,
  buildFriendDirectory,
  isFriendVisibility,
} from "./friends.js";
export type { FriendVisibility, SharedByMe, SharedWithMe, FriendEntry } from "./friends.js";
export { searchUsers, getProfileSummary, setUsername, normalizeUsername } from "./users.js";
export type { UserSummary } from "./users.js";
export { upsertPerson, appendPersonFact, personPath, setPersonHeadline } from "./people.js";
export type { UpsertPersonInput, PersonWriteResult } from "./people.js";
export { profilePerson, profileStalePeople, profileConcept, profileStaleConcepts } from "./profile.js";
export type { ProfilePersonResult, ProfileBatchResult, ProfileOptions } from "./profile.js";
export {
  PROJECT_KINDS,
  upsertProject,
  addToProject,
  projectIndexPath,
} from "./projects.js";
export type {
  ProjectKind,
  UpsertProjectInput,
  AddToProjectInput,
  ProjectWriteResult,
} from "./projects.js";
export {
  addCommitment,
  setCommitmentStatus,
  setCommitmentOwner,
  stampFlowyaTaskId,
  listCommitments,
} from "./actions.js";
export type {
  CommitmentOwner,
  CommitmentStatus,
  AddCommitmentInput,
  CommitmentWriteResult,
  ListCommitmentsOptions,
} from "./actions.js";
export { ingest, distillEnabled } from "./ingest.js";
export type { IngestInput, IngestResult } from "./ingest.js";
export {
  encryptCredential,
  decryptCredential,
  listConnections,
  getConnectionWithCredential,
  upsertConnection,
  updateConnection,
  deleteConnection,
  listActiveConnectionsForProvider,
} from "./connections.js";
export type {
  Connection,
  ConnectionWithCredential,
  ConnectionSettings,
  ConnectionStatus,
  BackfillState,
  BackfillItem,
  UpsertConnectionInput,
  ConnectionStatePatch,
} from "./connections.js";
export { researchBrain } from "./research.js";
export type { ResearchResult, ResearchOptions, ResearchSource } from "./research.js";
export { writeBrain } from "./writer.js";
export type { WriteResult, WriteCategory } from "./writer.js";
export { modelForTier, llmEnabled } from "./llm.js";
export { distill } from "./distill.js";
export type {
  DistillResult,
  DistillInput,
  IngestKind,
  IngestMode,
  GroundingContext,
} from "./distill.js";
export {
  type HistoryEntry,
  type WriteAttribution,
  type VersionOp,
} from "./versions/types.js";
export { attributionFromAuth } from "./write-attribution.js";

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
  const versionsEnabled = process.env.VERSIONS_ENABLED !== "false";
  let versions: VersionStore;
  if (!versionsEnabled) {
    versions = new NoopVersionStore();
  } else if (backend === "fs") {
    versions = new FsVersionStore(process.env.VERSIONS_DIR ?? "./versions");
  } else {
    versions = new SupabaseVersionStore();
  }
  _core = {
    brain: new Brain(vault, index, versions),
    vault,
    backend,
    getConfig: getUserConfig,
    setConfig: setUserConfig,
  };
  return _core;
}
