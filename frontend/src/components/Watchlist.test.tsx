import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Watchlist } from "./Watchlist";
import { ApiError } from "@/lib/api";
import type { PricePoint } from "@/lib/types";
import { renderWithTerminal, tick, watched } from "@/test/harness";

const price = (ticker: string) => screen.getByTestId(`price-${ticker}`);

function buffer(...values: number[]): PricePoint[] {
  return values.map((p, index) => ({ t: 1_700_000_000_000 + index * 500, p }));
}

describe("Watchlist rendering", () => {
  it("shows an empty state with no symbols", () => {
    renderWithTerminal(<Watchlist />, { watchlist: [] });
    expect(screen.getByText("No symbols watched. Add one below.")).toBeInTheDocument();
    expect(screen.getByText("0 symbols")).toBeInTheDocument();
  });

  it("renders a dash rather than NaN before any price has streamed", () => {
    renderWithTerminal(<Watchlist />, { watchlist: [watched("AAPL")] });
    expect(price("AAPL")).toHaveTextContent("—");
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders one row per watched symbol with the streamed price", () => {
    renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 189), watched("MSFT", 410)],
      prices: { AAPL: tick("AAPL", 190.25, 190) },
    });

    // The SSE tick wins over the price the REST watchlist returned.
    expect(price("AAPL")).toHaveTextContent("190.25");
    expect(price("MSFT")).toHaveTextContent("410.00");
    expect(screen.getByText("2 symbols")).toBeInTheDocument();
  });

  it("reports the session move from the sparkline buffer, not the tick-over-tick move", () => {
    renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 200)],
      prices: { AAPL: tick("AAPL", 200, 199.99) },
      buffers: { AAPL: buffer(100, 150, 200) },
    });

    // 100 → 200 since page load, not the +0.005% of the last tick.
    expect(screen.getByRole("button", { name: "Select AAPL" })).toHaveTextContent("+100.00%");
  });

  it("falls back to the stream's change percent until the buffer has two points", () => {
    renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190)],
      prices: { AAPL: tick("AAPL", 190, 189) },
      buffers: { AAPL: buffer(190) },
    });

    const row = screen.getByRole("button", { name: "Select AAPL" });
    expect(row).toHaveTextContent("▲");
    expect(row).toHaveTextContent("+0.53%");
  });

  it("marks the selected row and reports selection to the terminal", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190), watched("MSFT", 410)],
      selected: "AAPL",
    });

    expect(screen.getByRole("button", { name: "Select AAPL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Select MSFT" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Select MSFT" }));
    expect(state.select).toHaveBeenCalledWith("MSFT");
  });
});

describe("Watchlist price flash", () => {
  it("flashes green on an uptick and red on a downtick", () => {
    const { update } = renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190)],
      prices: { AAPL: tick("AAPL", 190) },
    });
    expect(price("AAPL").className).not.toMatch(/flash-/);

    update({ prices: { AAPL: tick("AAPL", 190.5, 190) } });
    expect(price("AAPL")).toHaveTextContent("190.50");
    expect(price("AAPL").className).toMatch(/flash-up/);

    update({ prices: { AAPL: tick("AAPL", 189.75, 190.5) } });
    expect(price("AAPL").className).toMatch(/flash-down/);
  });

  it("does not flash a row whose price did not move", () => {
    const { update } = renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190), watched("MSFT", 410)],
      prices: { AAPL: tick("AAPL", 190), MSFT: tick("MSFT", 410) },
    });

    update({ prices: { AAPL: tick("AAPL", 191, 190), MSFT: tick("MSFT", 410) } });

    expect(price("AAPL").className).toMatch(/flash-up/);
    expect(price("MSFT").className).not.toMatch(/flash-/);
  });
});

describe("Watchlist add and remove", () => {
  it("adds an uppercased ticker and selects it", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<Watchlist />, { watchlist: [watched("AAPL", 190)] });

    await user.type(screen.getByLabelText("Add ticker to watchlist"), "pypl");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(state.addTicker).toHaveBeenCalledWith("PYPL");
    expect(state.select).toHaveBeenCalledWith("PYPL");
    await waitFor(() =>
      expect(screen.getByLabelText("Add ticker to watchlist")).toHaveValue(""),
    );
  });

  it("submits on Enter as well as the button", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<Watchlist />, { watchlist: [] });

    await user.type(screen.getByLabelText("Add ticker to watchlist"), "NFLX{Enter}");

    expect(state.addTicker).toHaveBeenCalledWith("NFLX");
  });

  it("keeps the add button disabled while the field is empty or whitespace", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<Watchlist />, { watchlist: [] });

    const button = screen.getByRole("button", { name: "Add" });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText("Add ticker to watchlist"), "   ");
    expect(button).toBeDisabled();
    expect(state.addTicker).not.toHaveBeenCalled();
  });

  it("surfaces the backend's rejection message", async () => {
    const user = userEvent.setup();
    const addTicker = vi.fn().mockRejectedValue(new ApiError("Unknown ticker 'ZZZZ'", 400));
    renderWithTerminal(<Watchlist />, { watchlist: [], addTicker });

    await user.type(screen.getByLabelText("Add ticker to watchlist"), "ZZZZ{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown ticker 'ZZZZ'");
    // The draft survives a failure so the user can correct it.
    expect(screen.getByLabelText("Add ticker to watchlist")).toHaveValue("ZZZZ");
  });

  it("removes a ticker through its row button", async () => {
    const user = userEvent.setup();
    const { state } = renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190), watched("MSFT", 410)],
    });

    await user.click(
      screen.getByRole("button", { name: "Remove MSFT from watchlist" }),
    );

    expect(state.removeTicker).toHaveBeenCalledWith("MSFT");
    expect(state.removeTicker).toHaveBeenCalledTimes(1);
  });

  it("reports a failed removal instead of silently dropping it", async () => {
    const user = userEvent.setup();
    const removeTicker = vi.fn().mockRejectedValue(new ApiError("Ticker not watched", 404));
    renderWithTerminal(<Watchlist />, { watchlist: [watched("AAPL", 190)], removeTicker });

    await user.click(screen.getByRole("button", { name: "Remove AAPL from watchlist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ticker not watched");
  });

  it("reflects a removal once the terminal state drops the row", () => {
    const { update } = renderWithTerminal(<Watchlist />, {
      watchlist: [watched("AAPL", 190), watched("MSFT", 410)],
    });
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(2);

    update({ watchlist: [watched("AAPL", 190)] });

    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(1);
    expect(screen.queryByTestId("price-MSFT")).toBeNull();
    expect(screen.getByText("1 symbols")).toBeInTheDocument();
  });
});
