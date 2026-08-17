"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { Header } from "@/components/Header";
import { MainChart } from "@/components/MainChart";
import { PnlChart } from "@/components/PnlChart";
import { PortfolioHeatmap } from "@/components/PortfolioHeatmap";
import { PositionsTable } from "@/components/PositionsTable";
import { TradeBar } from "@/components/TradeBar";
import { Watchlist } from "@/components/Watchlist";
import { useTerminal } from "@/state/terminal";

/**
 * The workstation grid. Fixed viewport, panels scroll internally: three columns
 * of instruments between a header rail and the trade bar, with the assistant
 * docked on the right.
 *
 *   ┌──────────────── header ────────────────┬──────┐
 *   │ watchlist │ chart      │ heatmap       │      │
 *   │           ├────────────┤───────────────│ chat │
 *   │           │ positions  │ portfolio p&l │      │
 *   ├──────────────── trade bar ─────────────┴──────┤
 */
export function Terminal() {
  const [chatOpen, setChatOpen] = useState(true);
  const { error } = useTerminal();

  return (
    <div className="flex h-full flex-col bg-terminal">
      <Header />

      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-down/40 bg-down/10 px-4 py-1 text-xs text-down"
        >
          {error} — is the backend running on port 8000?
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <main className="grid min-h-0 min-w-0 flex-1 grid-cols-[300px_minmax(0,1.35fr)_minmax(0,1fr)] grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)] gap-px bg-border">
          <Watchlist className="row-span-2" />
          <MainChart />
          <PortfolioHeatmap />
          <PositionsTable />
          <PnlChart />
        </main>

        <ChatPanel open={chatOpen} onToggle={() => setChatOpen((open) => !open)} />
      </div>

      <TradeBar />
    </div>
  );
}
