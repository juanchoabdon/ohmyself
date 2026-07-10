"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Space, SpaceMember } from "@/lib/types";
import { SPACE_PALETTE } from "./SpaceSwitcher";

/** Branding + membership management for the active space. Branding (accent) is
 *  available on any space the caller owns; name/logo/members are for company
 *  spaces. Everything is gated to the owner. */
export function SpaceSettings({
  token,
  space,
  onUpdated,
}: {
  token: string;
  space: Space;
  onUpdated: (space: Space) => void;
}) {
  const isOwner = space.role === "owner";
  const isCompany = space.kind === "company";

  const [name, setName] = useState(space.name);
  const [color, setColor] = useState<string | null>(space.themeColor);
  const [logoUrl, setLogoUrl] = useState(space.logoUrl ?? "");
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setName(space.name);
    setColor(space.themeColor);
    setLogoUrl(space.logoUrl ?? "");
  }, [space]);

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setBrandError("Logo must be under 2 MB");
      return;
    }
    setUploading(true);
    setBrandError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      const { space: updated, logoUrl: url } = await api.uploadSpaceLogo(token, space.id, dataUrl);
      setLogoUrl(url);
      onUpdated(updated);
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Could not upload logo");
    } finally {
      setUploading(false);
    }
  }

  async function saveBranding() {
    setSavingBrand(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      const { space: updated } = await api.updateSpace(token, space.id, {
        name: isCompany ? name.trim() : undefined,
        themeColor: color,
        logoUrl: isCompany ? logoUrl.trim() || null : undefined,
      });
      onUpdated(updated);
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 1600);
    } catch (e) {
      setBrandError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingBrand(false);
    }
  }

  return (
    <div className="space-y-7">
      <section>
        <h3 className="text-sm font-semibold text-ink">
          {isCompany ? "Company wiki" : "Appearance"}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {isCompany
            ? "Name, accent and logo for this shared wiki. The accent re-skins the whole app when this space is active."
            : "Pick an accent color for your personal space. It re-skins the app when this space is active."}
        </p>

        {isCompany && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
            />
          </label>
        )}

        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Accent</span>
          <div className="flex flex-wrap items-center gap-2">
            {SPACE_PALETTE.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!isOwner}
                onClick={() => setColor(p.value)}
                title={p.label}
                aria-label={p.label}
                aria-pressed={color === p.value}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all disabled:opacity-60 ${
                  color === p.value ? "ring-ink" : "ring-transparent hover:ring-border"
                }`}
                style={{ background: p.value }}
              />
            ))}
            <button
              type="button"
              disabled={!isOwner}
              onClick={() => setColor(null)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                color === null ? "border-ink text-ink" : "border-border text-muted hover:text-ink"
              }`}
            >
              Default
            </button>
          </div>
        </div>

        {isCompany && (
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
              Logo <span className="font-normal normal-case text-muted/70">(optional)</span>
            </span>
            <div className="flex items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-bg"
                aria-hidden
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-muted">{name.slice(0, 1).toUpperCase() || "?"}</span>
                )}
              </span>
              <label
                className={`cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand ${
                  !isOwner || uploading ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  disabled={!isOwner || uploading}
                  onChange={onLogoFile}
                />
              </label>
              {logoUrl && isOwner && (
                <button
                  type="button"
                  onClick={() => setLogoUrl("")}
                  className="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink"
                >
                  Remove
                </button>
              )}
            </div>
            <label className="mt-2 block">
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={!isOwner}
                placeholder="…or paste an image URL"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand disabled:opacity-60"
              />
            </label>
          </div>
        )}

        {brandError && <p className="mt-2 text-sm text-vis-secret">{brandError}</p>}
        {isOwner && (
          <button
            onClick={saveBranding}
            disabled={savingBrand}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
          >
            {savingBrand ? "Saving…" : brandSaved ? "Saved" : "Save"}
          </button>
        )}
        {!isOwner && (
          <p className="mt-2 text-xs text-muted">Only the owner can change branding.</p>
        )}
      </section>

      {isCompany && <MembersSection token={token} space={space} isOwner={isOwner} />}
    </div>
  );
}

function MembersSection({ token, space, isOwner }: { token: string; space: Space; isOwner: boolean }) {
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .listMembers(token, space.id)
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load members"))
      .finally(() => setLoading(false));
  }, [token, space.id]);

  async function add() {
    if (!identifier.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addMember(token, space.id, identifier.trim(), role);
      setIdentifier("");
      const { members: list } = await api.listMembers(token, space.id);
      setMembers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    try {
      await api.removeMember(token, space.id, userId);
      setMembers((m) => m.filter((x) => x.userId !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove member");
    }
  }

  async function changeRole(userId: string, next: "member" | "admin") {
    try {
      await api.updateMemberRole(token, space.id, userId, next);
      setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, role: next } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change role");
    }
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Members</h3>
      <p className="mt-1 text-sm text-muted">
        Everyone here can read and write the wiki. Add teammates by their @handle or email.
      </p>

      {isOwner && (
        <div className="relative mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add by name or @handle"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={add}
            disabled={busy || !identifier.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "…" : "Add"}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-vis-secret">{error}</p>}

      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {loading && <p className="px-3 py-3 text-sm text-muted">Loading…</p>}
        {!loading && members.length === 0 && <p className="px-3 py-3 text-sm text-muted">No members yet.</p>}
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-muted">
                  {m.role}
                </span>
              </div>
              {m.username && <div className="mt-0.5 truncate text-xs text-muted">@{m.username}</div>}
            </div>
            {isOwner && m.role !== "owner" && (
              <div className="flex shrink-0 items-center gap-1.5">
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value as "member" | "admin")}
                  className="rounded-md border border-border bg-bg px-1.5 py-1 text-xs focus:border-brand"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => remove(m.userId)}
                  className="rounded-md px-2 py-1 text-xs text-vis-secret hover:bg-vis-secret/10"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
