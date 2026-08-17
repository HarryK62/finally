import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Header } from "./Header";
import type { PortfolioResponse } from "@/lib/types";
import { position, renderWithTerminal, tick } from "@/test/harness";

function portfolio(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    cash_balance: 8_200,
    positions: [position("AAPL", 10, 180, 190)],
    positions_value: 1_900,
    total_value: 10_100,
    total_cost_basis: 1_800,
    total_unrealized_pnl: 100,
    total_unrealized_pnl_percent: 5.5556,
    ...overrides,
  };
}

/** The value block sitting under a given header caption. */
function stat(label: string): HTMLElement {
  const caption = screen.getByText(label);
  const value = caption.nextElementSibling;
  if (!value) throw new Error(`no value rendered for ${label}`);
  return value as HTMLElement;
}

describe("Header", () => {
  it("renders dashes, not NaN, before the first portfolio fetch", () => {
    renderWithTerminal(<Header />, { portfolio: null });

    expect(stat("Portfolio Value")).toHaveTextContent("—");
    expect(stat("Cash")).toHaveTextContent("—");
    expect(stat("Unrealized P&L")).toHaveTextContent("—");
    expect(stat("Return")).toHaveTextContent("—");
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("shows total value, cash, P&L and return from the portfolio", () => {
    renderWithTerminal(<Header />, {
      portfolio: portfolio(),
      prices: { AAPL: tick("AAPL", 190) },
    });

    expect(stat("Portfolio Value")).toHaveTextContent("$10,100.00");
    expect(stat("Cash")).toHaveTextContent("$8,200.00");
    expect(stat("Unrealized P&L")).toHaveTextContent("▲ +$100.00");
    expect(stat("Return")).toHaveTextContent("+5.56%");
  });

  it("re-prices the total from the live stream, not the stale REST total", () => {
    renderWithTerminal(<Header />, {
      portfolio: portfolio(),
      prices: { AAPL: tick("AAPL", 200, 190) },
    });

    // 8,200 cash + 10 shares @ 200 = 10,200, against a REST total of 10,100.
    expect(stat("Portfolio Value")).toHaveTextContent("$10,200.00");
    expect(stat("Unrealized P&L")).toHaveTextContent("+$200.00");
  });

  it("colours a losing portfolio red and a winning one green", () => {
    const { update } = renderWithTerminal(<Header />, {
      portfolio: portfolio(),
      prices: { AAPL: tick("AAPL", 200, 190) },
    });
    expect(stat("Unrealized P&L")).toHaveClass("text-up");
    expect(stat("Return")).toHaveClass("text-up");

    update({ prices: { AAPL: tick("AAPL", 150, 190) } });
    expect(stat("Unrealized P&L")).toHaveTextContent("▼ -$300.00");
    expect(stat("Unrealized P&L")).toHaveClass("text-down");
    expect(stat("Return")).toHaveClass("text-down");
  });

  it("flashes the total value when it moves, and not on first paint", () => {
    const { update } = renderWithTerminal(<Header />, {
      portfolio: portfolio(),
      prices: { AAPL: tick("AAPL", 190) },
    });
    expect(stat("Portfolio Value").className).not.toMatch(/flash-/);

    update({ prices: { AAPL: tick("AAPL", 191, 190) } });
    expect(stat("Portfolio Value").className).toMatch(/flash-up/);

    update({ prices: { AAPL: tick("AAPL", 180, 191) } });
    expect(stat("Portfolio Value").className).toMatch(/flash-down/);
  });

  it("does not flash on sub-cent drift", () => {
    const { update } = renderWithTerminal(<Header />, {
      portfolio: portfolio(),
      prices: { AAPL: tick("AAPL", 190) },
    });

    // 10 shares: a 0.00005 move is half a cent on the total, which rounds away.
    update({ prices: { AAPL: tick("AAPL", 190.00004, 190) } });
    expect(stat("Portfolio Value").className).not.toMatch(/flash-/);
  });

  it("shows the market source badge only once health has loaded", () => {
    const { update } = renderWithTerminal(<Header />, { portfolio: portfolio() });
    expect(screen.queryByText(/simulator/)).toBeNull();

    update({ health: { status: "ok", market_source: "simulator", llm_mock: true } });
    expect(screen.getByText(/simulator/)).toHaveTextContent("simulator · mock ai");
  });

  it("carries the connection status dot", () => {
    const { update } = renderWithTerminal(<Header />, { portfolio: portfolio() });
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "open");

    update({ status: "closed" });
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "closed");
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });
});
