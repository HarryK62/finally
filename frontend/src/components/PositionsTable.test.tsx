import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PositionsTable } from "./PositionsTable";
import type { PortfolioResponse } from "@/lib/types";
import { position, renderWithTerminal, tick } from "@/test/harness";

function portfolio(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    cash_balance: 5_000,
    positions: [],
    positions_value: 0,
    total_value: 5_000,
    total_cost_basis: 0,
    total_unrealized_pnl: 0,
    total_unrealized_pnl_percent: 0,
    ...overrides,
  };
}

function rowFor(ticker: string): HTMLElement {
  const cell = screen.getByText(ticker);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${ticker}`);
  return row;
}

const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent?.trim());

describe("PositionsTable", () => {
  it("shows a loading state before the first fetch settles", () => {
    renderWithTerminal(<PositionsTable />, { portfolio: null, loading: true });
    expect(screen.getByText("Loading portfolio…")).toBeInTheDocument();
  });

  it("prompts for a first trade once loaded with no positions", () => {
    renderWithTerminal(<PositionsTable />, { portfolio: portfolio(), loading: false });
    expect(screen.getByText("No positions yet — place a trade below.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("formats every column of a position row", () => {
    renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices: { AAPL: tick("AAPL", 190) },
    });

    expect(cells(rowFor("AAPL"))).toEqual([
      "AAPL",
      "10",
      "180.00",
      "190.00",
      "$1,900.00",
      "+$100.00",
      "▲ +5.56%",
    ]);
  });

  it("renders a loss with the down class and a negative sign", () => {
    renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("TSLA", 4, 250, 250)] }),
      prices: { TSLA: tick("TSLA", 200) },
    });

    const row = rowFor("TSLA");
    expect(within(row).getByText("-$200.00")).toHaveClass("text-down");
    expect(within(row).getByText(/-20\.00%/)).toHaveClass("text-down");
  });

  it("prints fractional quantities without inventing precision", () => {
    renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("NVDA", 0.5, 900, 900)] }),
      prices: { NVDA: tick("NVDA", 900) },
    });

    expect(cells(rowFor("NVDA"))[1]).toBe("0.5");
  });

  it("sorts by market value, largest first", () => {
    renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({
        positions: [position("AAPL", 1, 100, 100), position("NVDA", 10, 100, 100)],
      }),
      prices: { AAPL: tick("AAPL", 100), NVDA: tick("NVDA", 100) },
    });

    const symbols = screen
      .getAllByRole("row")
      .slice(1, 3)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(symbols).toEqual(["NVDA", "AAPL"]);
  });

  it("totals market value and P&L in the footer", () => {
    renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({
        positions: [position("AAPL", 10, 180, 180), position("MSFT", 5, 400, 400)],
      }),
      prices: { AAPL: tick("AAPL", 190), MSFT: tick("MSFT", 420) },
    });

    const totalRow = rowFor("TOTAL");
    expect(within(totalRow).getByText("$4,000.00")).toBeInTheDocument();
    expect(within(totalRow).getByText("+$200.00")).toBeInTheDocument();
    expect(within(totalRow).getByText(/\+5\.26%/)).toBeInTheDocument();
    expect(screen.getByText("Cost basis $3,800.00")).toBeInTheDocument();
  });

  it("re-prices from the stream between portfolio polls", () => {
    const { update } = renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices: { AAPL: tick("AAPL", 180) },
    });
    expect(cells(rowFor("AAPL"))[5]).toBe("+$0.00");

    update({ prices: { AAPL: tick("AAPL", 185, 180) } });
    expect(cells(rowFor("AAPL"))[3]).toBe("185.00");
    expect(cells(rowFor("AAPL"))[5]).toBe("+$50.00");
  });

  it("flashes the last-price cell on a tick", () => {
    const { update } = renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices: { AAPL: tick("AAPL", 180) },
    });

    update({ prices: { AAPL: tick("AAPL", 181, 180) } });
    expect(screen.getByText("181.00").className).toMatch(/flash-up/);

    update({ prices: { AAPL: tick("AAPL", 179, 181) } });
    expect(screen.getByText("179.00").className).toMatch(/flash-down/);
  });

  it("selects a ticker when its row is clicked", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<PositionsTable />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 190)] }),
      prices: { AAPL: tick("AAPL", 190) },
    });

    await user.click(rowFor("AAPL"));
    expect(state.select).toHaveBeenCalledWith("AAPL");
  });
});
