"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { api, ApiError } from "@/lib/api";
import { fmtNumber, fmtQuantity } from "@/lib/format";
import type { ChatAction, ChatMessage } from "@/lib/types";
import { useTerminal } from "@/state/terminal";

const SUGGESTIONS = [
  "How is my portfolio doing?",
  "Buy 5 NVDA",
  "What is my biggest risk?",
];

/** A locally-rendered notice — never persisted, never sent to the model. */
interface Notice {
  id: string;
  role: "notice";
  content: string;
  created_at: string;
}

type Entry = ChatMessage | Notice;

function nextId(): string {
  return `local-${Math.random().toString(36).slice(2)}`;
}

function ActionChip({ action }: { action: ChatAction }) {
  const failed = action.status === "failed";
  const summary =
    action.type === "trade"
      ? `${action.side === "sell" ? "SELL" : "BUY"} ${fmtQuantity(action.quantity)} ${
          action.ticker
        }${action.price != null ? ` @ $${fmtNumber(action.price)}` : ""}`
      : `${action.action === "remove" ? "REMOVE" : "ADD"} ${action.ticker}`;

  return (
    <li
      className={`flex items-start gap-2 rounded-sm border px-2 py-1 text-[11px] ${
        failed ? "border-down/40 bg-down/10" : "border-up/40 bg-up/10"
      }`}
    >
      <span aria-hidden className={failed ? "text-down" : "text-up"}>
        {failed ? "✕" : "✓"}
      </span>
      <span className="min-w-0">
        <span className="numeric font-semibold text-ink">{summary}</span>
        <span className="ml-1 text-ink-dim">{action.detail}</span>
      </span>
    </li>
  );
}

function Bubble({ entry }: { entry: Entry }) {
  if (entry.role === "notice") {
    return (
      <div className="mx-auto max-w-[92%] rounded-sm border border-border-strong bg-panel-raised px-2 py-1.5 text-center text-[11px] text-muted">
        {entry.content}
      </div>
    );
  }

  const isUser = entry.role === "user";
  const actions = entry.role === "assistant" ? (entry.actions ?? []) : [];

  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <span className="px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
        {isUser ? "You" : "FinAlly"}
      </span>
      <div
        className={`max-w-[92%] whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-xs leading-relaxed ${
          isUser
            ? "bg-primary/15 text-ink ring-1 ring-primary/30"
            : "bg-panel-raised text-ink ring-1 ring-border"
        }`}
      >
        {entry.content}
      </div>
      {actions.length > 0 ? (
        <ul className="flex w-[92%] flex-col gap-1">
          {actions.map((action, index) => (
            <ActionChip key={`${action.type}-${action.ticker}-${index}`} action={action} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ChatPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { refresh } = useTerminal();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Chat is owned by another agent and may not be deployed yet; a 404 must
  // leave the terminal fully usable rather than throwing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const history = await api.chatHistory();
        if (!cancelled && history.messages.length > 0) setEntries(history.messages);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setEntries([
            {
              id: nextId(),
              role: "notice",
              content: "AI assistant is not connected yet.",
              created_at: new Date().toISOString(),
            },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, sending, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;

    setDraft("");
    setEntries((current) => [
      ...current,
      { id: nextId(), role: "user", content: message, actions: null, created_at: new Date().toISOString() },
    ]);
    setSending(true);

    try {
      const response = await api.chat(message);
      setEntries((current) => [
        ...current,
        {
          id: response.id,
          role: "assistant",
          content: response.message,
          actions: response.actions ?? [],
          created_at: response.created_at,
        },
      ]);
      // The assistant may have traded or edited the watchlist on our behalf.
      if ((response.actions ?? []).some((action) => action.status === "executed")) {
        await refresh();
      }
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.status === 404
            ? "AI assistant is not connected yet."
            : err.message
          : "AI assistant is unavailable.";
      setEntries((current) => [
        ...current,
        { id: nextId(), role: "notice", content: detail, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open AI assistant"
        aria-expanded={false}
        className="flex w-9 shrink-0 flex-col items-center justify-center gap-3 border-l border-border bg-panel text-muted transition-colors hover:bg-panel-raised hover:text-accent"
      >
        <span aria-hidden className="text-base">
          ✦
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ writingMode: "vertical-rl" }}
        >
          AI Assistant
        </span>
      </button>
    );
  }

  return (
    // Below desk width the assistant floats over the grid instead of taking a
    // column of it: 360px out of a 768px tablet is half the workstation.
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[360px] max-w-[85vw] shrink-0 flex-col border-l border-border bg-panel shadow-[0_0_40px_rgba(0,0,0,0.55)] xl:static xl:max-w-none xl:shadow-none">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-panel-raised px-3">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          <span aria-hidden className="text-accent">
            ✦
          </span>
          FinAlly Assistant
        </h2>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse AI assistant"
          aria-expanded
          className="px-1 text-sm leading-none text-muted hover:text-ink"
        >
          ›
        </button>
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="m-auto max-w-[85%] text-center text-xs leading-relaxed text-muted">
            Ask about your portfolio, or tell me what to trade.
          </div>
        ) : (
          entries.map((entry) => <Bubble key={entry.id} entry={entry} />)
        )}

        {sending ? (
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted" role="status">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            FinAlly is thinking…
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={sending}
              onClick={() => void send(suggestion)}
              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask or instruct…"
            aria-label="Message the AI assistant"
            disabled={sending}
            className="min-w-0 flex-1 rounded-sm border border-border bg-terminal px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-primary focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="rounded-sm bg-secondary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}
