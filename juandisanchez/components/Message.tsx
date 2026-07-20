"use client";

import { Avatar } from "./Avatar";
import { RichMarkdown, type AllowedLink } from "./Rich";
import type { Lang } from "@/lib/i18n";

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  followups?: string[];
  /** The URL allowlist for THIS reply (from the server's `X-Links` header),
   *  used to sanitize links/cards/images at render time. */
  links?: AllowedLink[];
}

export function MessageBubble({
  message,
  streaming,
  lang = "en",
  status,
}: {
  message: ChatMessage;
  streaming?: boolean;
  lang?: Lang;
  /** In-voice micro-status ("one sec, checking my notes…") shown instantly
   *  while this message is still empty — makes the wait feel like a person
   *  reacting, not a bot buffering. */
  status?: string;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="msg-in flex justify-end">
        <div className="bubble-user max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[0.95rem] font-medium leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-in flex gap-3">
      <Avatar size={32} />
      <div className="min-w-0 flex-1 pt-0.5">
        {message.content ? (
          <div className="prose">
            <RichMarkdown lang={lang} collapse={!streaming} allowedLinks={message.links}>
              {message.content}
            </RichMarkdown>
            {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-brand align-middle" />}
          </div>
        ) : (
          <TypingDots status={status} />
        )}
      </div>
    </div>
  );
}

function TypingDots({ status }: { status?: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1.5" aria-label={status || "Thinking"}>
      <span className="typing-dot" />
      <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
      <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
      {status && <span className="msg-in ml-1 text-sm italic text-muted">{status}</span>}
    </div>
  );
}
