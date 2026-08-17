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
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTerminal } from "@/state/terminal";

/**
 * Below this the full three-column desk stops being readable: a 300px watchlist
 * plus a 360px assistant leaves each chart column around 200px. Under it the
 * grid reflows to two columns and the assistant starts collapsed.
 */
const DESK_WIDTH = "(min-width: 1280px)";

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
 *
 * Under `DESK_WIDTH` the same five panels fall into two columns and three rows,
 * with the assistant floating over the grid instead of taking a share of it:
 *
 *   ┌──────── header ────────┐
 *   │ watchlist │ chart      │
 *   │           ├────────────┤
 *   │           │ heatmap    │
 *   ├───────────┼────────────┤
 *   │ positions │ p&l        │
 *   ├──────── trade bar ─────┤
 */
export function Terminal() {
  // Desktop-first: the export prerenders with the assistant docked open, and a
  // narrow client collapses it to its rail on the commit after hydration.
  const wideEnoughForChat = useMediaQuery(DESK_WIDTH, true);
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const chatOpen = chatOverride ?? wideEnoughForChat;
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

      <div className="relative flex min-h-0 flex-1">
        {/*
         * Narrow: auto rows with a 180px floor, so a short tablet viewport
         * scrolls the grid rather than crushing the charts. At desk width the
         * two explicit rows take over and nothing scrolls, as before.
         */}
        <main className="grid min-h-0 min-w-0 flex-1 auto-rows-[minmax(180px,1fr)] grid-cols-1 gap-px overflow-y-auto bg-border sm:grid-cols-2 xl:auto-rows-auto xl:grid-cols-[300px_minmax(0,1.35fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)] xl:overflow-y-hidden">
          <Watchlist className="row-span-2" />
          <MainChart />
          <PortfolioHeatmap />
          <PositionsTable />
          <PnlChart />
        </main>

        <ChatPanel open={chatOpen} onToggle={() => setChatOverride(!chatOpen)} />
      </div>

      <TradeBar />
    </div>
  );
}
