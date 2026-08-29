import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ChatPanel } from "@/components/chat-panel";

async function ChatContent() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("chat_messages")
    .select("id, role, content")
    .order("created_at", { ascending: true })
    .limit(50);

  const messages = (rows ?? []).map((r) => ({
    id: r.id as string,
    role: r.role as "user" | "assistant",
    content: r.content as string,
  }));

  return <ChatPanel initialMessages={messages} />;
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function ChatPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-bold text-2xl">Chat</h1>
        <p className="text-sm text-foreground/60">
          Ask questions or give directives about your team — preferences you state here
          get remembered and factored into every future waiver/trade/lineup
          recommendation.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <ChatContent />
      </Suspense>
    </div>
  );
}
