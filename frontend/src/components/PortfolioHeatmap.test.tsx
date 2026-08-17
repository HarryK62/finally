import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioHeatmap } from "./PortfolioHeatmap";
import { heatFill } from "@/lib/heat";
import type { PortfolioResponse } from "@/lib/types";
import { position, renderWithTerminal, tick } from "@/test/harness";

const BOX = { width: 400, height: 300 };

// jsdom lays nothing out; the treemap needs real pixels to divide up.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: BOX.width,
    bottom: BOX.height,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

const cell = (ticker: string, pnlPercent: string) =>
  screen.getByRole("button", {
    name: `${ticker}, ${pnlPercent} unrealized profit and loss`,
  });

describe("PortfolioHeatmap", () => {
  it("shows an empty state with no positions", () => {
    renderWithTerminal(<PortfolioHeatmap />, { portfolio: portfolio() });
    expect(
      screen.getByText("No open positions. Buy something to populate the map."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("stays empty when positions exist but are worth nothing", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 0, 0)] }),
      prices: { AAPL: tick("AAPL", 0) },
    });
    expect(
      screen.getByText("No open positions. Buy something to populate the map."),
    ).toBeInTheDocument();
  });

  it("renders one cell per position with a labelled P&L", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({
        positions: [position("AAPL", 10, 180, 180), position("TSLA", 4, 250, 250)],
      }),
      prices: { AAPL: tick("AAPL", 189), TSLA: tick("TSLA", 245) },
    });

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(cell("AAPL", "+5.00%")).toBeInTheDocument();
    expect(cell("TSLA", "-2.00%")).toBeInTheDocument();
    expect(screen.getByText("2 positions · $2,870.00")).toBeInTheDocument();
  });

  it("sizes cells by portfolio weight", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({
        positions: [position("BIG", 30, 100, 100), position("SMALL", 10, 100, 100)],
      }),
      prices: { BIG: tick("BIG", 100), SMALL: tick("SMALL", 100) },
    });

    const big = cell("BIG", "+0.00%");
    const small = cell("SMALL", "+0.00%");
    const area = (node: HTMLElement) =>
      Number.parseFloat(node.style.width) * Number.parseFloat(node.style.height);

    expect(area(big)).toBeGreaterThan(area(small));
    // 3:1 weights, allowing for the 2px gutter shaved off each cell.
    expect(area(big) / area(small)).toBeGreaterThan(2.5);
  });

  it("colours gains green and losses red on the shared ramp", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({
        positions: [position("WIN", 10, 100, 100), position("LOSE", 10, 100, 100)],
      }),
      prices: { WIN: tick("WIN", 104), LOSE: tick("LOSE", 96) },
    });

    expect(cell("WIN", "+4.00%").style.backgroundColor).toBe(toRgb(heatFill(4)));
    expect(cell("LOSE", "-4.00%").style.backgroundColor).toBe(toRgb(heatFill(-4)));
  });

  it("rings the selected position in the accent colour", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({
        positions: [position("AAPL", 10, 100, 100), position("MSFT", 10, 100, 100)],
      }),
      prices: { AAPL: tick("AAPL", 110), MSFT: tick("MSFT", 110) },
      selected: "AAPL",
    });

    expect(cell("AAPL", "+10.00%").style.boxShadow).toContain("#ecad0a");
    expect(cell("MSFT", "+10.00%").style.boxShadow).not.toContain("#ecad0a");
  });

  it("selects a position when its cell is clicked", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices: { AAPL: tick("AAPL", 190) },
    });

    await user.click(cell("AAPL", "+5.56%"));
    expect(state.select).toHaveBeenCalledWith("AAPL");
  });

  it("prints the number beside the colour, since red/green alone is not readable", () => {
    renderWithTerminal(<PortfolioHeatmap />, {
      portfolio: portfolio({ positions: [position("AAPL", 10, 180, 180)] }),
      prices: { AAPL: tick("AAPL", 190) },
    });

    const only = cell("AAPL", "+5.56%");
    expect(only).toHaveTextContent("AAPL");
    expect(only).toHaveTextContent("+5.56%");
    expect(only).toHaveTextContent("$1,900.00");
  });
});

/** jsdom normalises inline colours to `rgb(...)`. */
function toRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
}
