"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MessageSquarePlus, Sparkles, Loader2, Send } from "lucide-react";
import * as React from "react";
import { refineDesign } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useDesignStore } from "@/store/designStore";
import { cn } from "@/lib/utils";

interface DesignChatProps {
  designId: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
}

export function DesignChat({ designId }: DesignChatProps) {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "intro",
      role: "system",
      text:
        "Type a natural-language change ('merge Party and Customer', 'add audit columns to all transactional tables'). The AI returns a reviewable revision you can approve below."
    }
  ]);

  const upsertPending = useDesignStore((s) => s.upsertPendingRevision);
  const selection = useDesignStore((s) => s.selection);
  const pendingChatPrompt = useDesignStore((s) => s.pendingChatPrompt);
  const setPendingChatPrompt = useDesignStore((s) => s.setPendingChatPrompt);

  // External code (e.g. a critique question card) can hand us a prefilled
  // prompt by writing to the store. Open ourselves, swap the input, then
  // clear the store slot so we don't re-pop on every render.
  React.useEffect(() => {
    if (!pendingChatPrompt) return;
    setOpen(true);
    setInput(pendingChatPrompt);
    setPendingChatPrompt(undefined);
  }, [pendingChatPrompt, setPendingChatPrompt]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setInput("");
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text
    };
    setMessages((m) => [...m, userMsg]);

    try {
      const scope =
        selection.kind === "field"
          ? "field"
          : selection.kind === "table"
            ? "table"
            : "global";
      const target =
        selection.kind === "field"
          ? `${selection.tableName}.${selection.fieldName}`
          : selection.kind === "table"
            ? selection.tableName
            : "";
      const resp = await refineDesign(designId, {
        scope,
        target,
        request: text
      });
      if (resp.revision) {
        upsertPending(resp.revision);
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: `Proposed: ${resp.revision?.change_summary ?? "(no summary)"} — review in the side panel.`
          }
        ]);
      } else if (resp.error) {
        setMessages((m) => [
          ...m,
          { id: `e-${Date.now()}`, role: "system", text: `Error: ${resp.error}` }
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            id: `e-${Date.now()}`,
            role: "system",
            text: "No revision returned."
          }
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `e-${Date.now()}`,
          role: "system",
          text: `Failed: ${e instanceof Error ? e.message : String(e)}`
        }
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface/90 px-3.5",
          "text-xs font-medium tracking-tight shadow-glow backdrop-blur-sm hover:bg-surfaceAlt"
        )}
        title="Refine with natural language"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        {open ? "Close" : "Refine with chat"}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-[6.5rem] left-4 z-30 w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-border bg-surface/95 shadow-glow backdrop-blur"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquarePlus className="h-4 w-4 text-accent" />
                Design refinement
              </div>
              <div className="text-xs text-muted">
                Scope:{" "}
                {selection.kind === "none"
                  ? "global"
                  : selection.kind === "table"
                    ? `table ${selection.tableName}`
                    : `field ${selection.tableName}.${selection.fieldName}`}
              </div>
            </div>
            <div className="max-h-[40vh] overflow-y-auto p-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "mb-2 max-w-[85%] rounded-md px-3 py-2 text-sm",
                    m.role === "user"
                      ? "ml-auto bg-accent/15 text-text"
                      : m.role === "agent"
                        ? "bg-surfaceAlt text-text"
                        : "bg-bg/60 text-muted italic"
                  )}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 border-t border-border p-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe the change you want..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button onClick={send} disabled={sending || !input.trim()}>
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
