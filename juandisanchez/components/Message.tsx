"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Avatar } from "./Avatar";

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
}: {
  message: ChatMessage;
  streaming?: boolean;
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
              }}
            >
              {message.content}
            </ReactMarkdown>
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
