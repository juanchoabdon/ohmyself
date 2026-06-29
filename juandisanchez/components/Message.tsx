"use client";

import { Avatar } from "./Avatar";
import { RichMarkdown } from "./Rich";
import type { Lang } from "@/lib/i18n";

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  followups?: string[];
}

export function MessageBubble({
  message,
  streaming,
  lang = "en",
}: {
  message: ChatMessage;
  streaming?: boolean;
  lang?: Lang;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="msg-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[0.95rem] leading-relaxed text-white shadow-sm">
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
            <RichMarkdown lang={lang} collapse={!streaming}>
              {message.content}
            </RichMarkdown>
            {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-brand align-middle" />}
          </div>
        ) : (
          <TypingDots />
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1.5" aria-label="Thinking">
      <span className="typing-dot" />
      <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
      <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
    </div>
  );
}
