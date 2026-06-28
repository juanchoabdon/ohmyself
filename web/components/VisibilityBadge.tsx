import type { Visibility } from "@/lib/types";

const STYLES: Record<Visibility, { label: string; cls: string }> = {
  public: { label: "Public", cls: "text-vis-public bg-vis-public/10" },
  private: { label: "Private", cls: "text-vis-private bg-vis-private/10" },
  secret: { label: "Secret", cls: "text-vis-secret bg-vis-secret/10" },
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const s = STYLES[visibility];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
