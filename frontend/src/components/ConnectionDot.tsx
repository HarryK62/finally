"use client";

import type { ConnectionStatus } from "@/hooks/usePriceStream";

/**
 * Contract §8: green = open, yellow = reconnecting, red = errored/closed.
 * The label sits beside the dot so the state is never conveyed by color alone.
 */
const PRESENTATION: Record<
  ConnectionStatus,
  { color: string; label: string; pulse: boolean }
> = {
  open: { color: "bg-up", label: "LIVE", pulse: false },
  connecting: { color: "bg-accent", label: "CONNECTING", pulse: true },
  reconnecting: { color: "bg-accent", label: "RECONNECTING", pulse: true },
  closed: { color: "bg-down", label: "OFFLINE", pulse: false },
};

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const { color, label, pulse } = PRESENTATION[status];

  return (
    <div
      className="flex items-center gap-2"
      data-testid="connection-status"
      data-status={status}
      title={`Price stream: ${label.toLowerCase()}`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${color} ${pulse ? "pulse-dot" : ""}`}
      />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
        {label}
      </span>
    </div>
  );
}
