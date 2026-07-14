import { ForbiddenError } from "./errors.js";
import { allowedVisibilities, canWrite } from "./scope.js";
import type { AuthContext, Scope, SpaceRole, Visibility } from "./types.js";

/** Personal self space — `spaceId` equals the account id. */
export function isSelfSpace(auth: AuthContext): boolean {
  return auth.spaceId === auth.userId;
}

/** Company-space owner or admin. */
export function isSpaceAdmin(role: SpaceRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Visibilities the caller may read in the active space — scope cap intersected
 * with company-space role (plain members never see `secret`).
 */
export function effectiveAllowedForRole(scope: Scope, role: SpaceRole, selfSpace: boolean): Visibility[] {
  const cap = allowedVisibilities(scope);
  if (selfSpace || isSpaceAdmin(role)) return cap;
  return cap.filter((v) => v !== "secret");
}

export function effectiveAllowed(auth: AuthContext): Visibility[] {
  return effectiveAllowedForRole(auth.scope, auth.role, isSelfSpace(auth));
}

/** Public scope is read-only; private/secret can write (when role allows). */
export function requireWrite(auth: AuthContext): void {
  if (auth.readonly || !canWrite(auth.scope)) {
    throw new ForbiddenError("read-only (public scope)");
  }
}

/** Company spaces: only owner/admin may mutate notes, config, connectors. */
export function requireCompanyWrite(auth: AuthContext): void {
  requireWrite(auth);
  if (!isSelfSpace(auth) && !isSpaceAdmin(auth.role)) {
    throw new ForbiddenError(`role '${auth.role}' cannot write to this space`);
  }
}

/** Connections, Drive OAuth, and other space-level integrations. */
export function requireSpaceAdmin(auth: AuthContext): void {
  if (auth.via !== "jwt") {
    throw new ForbiddenError("requires a signed-in session");
  }
  if (!isSelfSpace(auth) && !isSpaceAdmin(auth.role)) {
    throw new ForbiddenError("admin role required for this space");
  }
}
