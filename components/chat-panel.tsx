"use client";

import { useRef, useState, useTransition } from "react";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { clearChat, sendChatMessage } from "@/app/(app)/chat/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * The chat UI itself — optimistic message list plus a send box. Each turn is one
 * round-trip Server Action call (`sendChatMessage` -> `runChatTurn`), not a streamed
 * response; a personal-use copilot doesn't need SSE plumbing for a few-second wait.
 */
export function ChatPanel({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed || isPending) return;
    setError(null);
    const optimisticUser: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput("");
    scrollToBottom();

    startTransition(async () => {
      const result = await sendChatMessage(trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", content: result.reply },
      ]);
      scrollToBottom();
    });
  };

  const clear = () => {
    if (messages.length === 0) return;
    if (!window.confirm("Clear the chat transcript? This only clears the conversation — any notes or strategy directives you've given stay in effect.")) {
      return;
    }
    setMessages([]);
    setError(null);
    startTransition(async () => {
      const result = await clearChat();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-14rem)] min-h-96">
      <div className="flex items-center justify-between gap-2 text-xs text-foreground/50 shrink-0">
        <p>
          Short-term: the last ~20 messages, just for conversational context. Long-term:
          preferences you state get saved as permanent notes every agent reads — clearing
          the chat below does NOT erase those.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending || messages.length === 0}
          onClick={clear}
          className="shrink-0 text-foreground/50 hover:text-destructive"
        >
          <Trash2 size={13} className="mr-1" />
          Clear
        </Button>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-foreground/50">
            <Sparkles size={22} />
            <p className="text-sm max-w-sm">
              Ask about your roster, or tell it things like &quot;I&apos;m OK trading
              Andrews&quot; or &quot;I only want to keep 2 QBs&quot; — it&apos;ll
              remember and factor that into future recommendations.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isPending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground/50 animate-pulse">
              Thinking…
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask a question or give a directive…"
          rows={2}
          className="flex-1 text-sm border rounded-md p-2 bg-background resize-none"
        />
        <Button size="sm" disabled={isPending || !input.trim()} onClick={send} className="self-end">
          <Send size={14} />
        </Button>
      </div>
    </div>
  );
}
