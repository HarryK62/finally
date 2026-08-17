import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./ChatPanel";
import { ApiError, api } from "@/lib/api";
import type { ChatHistoryResponse, ChatResponse } from "@/lib/types";
import { renderWithTerminal } from "@/test/harness";

// Chat is the one panel that talks to the backend directly rather than through
// terminal state, so the api module is the seam to mock.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { chat: vi.fn(), chatHistory: vi.fn() },
  };
});

const chat = vi.mocked(api.chat);
const chatHistory = vi.mocked(api.chatHistory);

const noHistory: ChatHistoryResponse = { messages: [] };

function reply(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    id: "assistant-1",
    message: "Your portfolio is up 2.4% today.",
    actions: [],
    created_at: "2026-08-17T14:00:00.000Z",
    ...overrides,
  };
}

/** Resolve manually, so the loading state can be observed mid-flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

const input = () => screen.getByLabelText("Message the AI assistant");
const sendButton = () => screen.getByRole("button", { name: "Send" });

beforeEach(() => {
  // jsdom implements no scrolling; the panel pins itself to the newest message.
  Element.prototype.scrollTo ??= () => undefined;

  chat.mockReset();
  chatHistory.mockReset();
  chatHistory.mockResolvedValue(noHistory);
});

describe("ChatPanel collapsed", () => {
  it("renders only a re-open affordance when closed", () => {
    const onToggle = vi.fn();
    renderWithTerminal(<ChatPanel open={false} onToggle={onToggle} />);

    expect(screen.getByRole("button", { name: "Open AI assistant" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Message the AI assistant")).toBeNull();
  });

  it("reports a toggle request", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithTerminal(<ChatPanel open={false} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "Open AI assistant" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPanel rendering", () => {
  it("invites a first message when there is no history", async () => {
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);
    expect(
      await screen.findByText("Ask about your portfolio, or tell me what to trade."),
    ).toBeInTheDocument();
  });

  it("renders stored history with role captions", async () => {
    chatHistory.mockResolvedValue({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "How am I doing?",
          actions: null,
          created_at: "2026-08-17T13:59:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "Up 2.4%.",
          actions: [],
          created_at: "2026-08-17T13:59:02.000Z",
        },
      ],
    });

    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    expect(await screen.findByText("How am I doing?")).toBeInTheDocument();
    expect(screen.getByText("Up 2.4%.")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("FinAlly")).toBeInTheDocument();
  });

  it("says so plainly when the assistant is not deployed", async () => {
    chatHistory.mockRejectedValue(new ApiError("Not Found", 404));
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    expect(await screen.findByText("AI assistant is not connected yet.")).toBeInTheDocument();
  });
});

describe("ChatPanel round trip", () => {
  it("echoes the user message, shows a loading indicator, then the reply", async () => {
    const user = userEvent.setup();
    const pending = deferred<ChatResponse>();
    chat.mockReturnValue(pending.promise);

    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.type(input(), "What should I trim first?");
    await user.click(sendButton());

    expect(screen.getByText("What should I trim first?")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("FinAlly is thinking…");
    expect(input()).toBeDisabled();
    expect(input()).toHaveValue("");

    pending.resolve(reply());

    expect(await screen.findByText("Your portfolio is up 2.4% today.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(input()).toBeEnabled();
    expect(chat).toHaveBeenCalledWith("What should I trim first?");
  });

  it("sends a suggestion chip with one click", async () => {
    const user = userEvent.setup();
    chat.mockResolvedValue(reply({ message: "Bought." }));
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Buy 5 NVDA" }));

    await waitFor(() => expect(chat).toHaveBeenCalledWith("Buy 5 NVDA"));
    expect(await screen.findByText("Bought.")).toBeInTheDocument();
  });

  it("keeps the send button disabled until there is something to send", async () => {
    const user = userEvent.setup();
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    expect(sendButton()).toBeDisabled();
    await user.type(input(), "   ");
    expect(sendButton()).toBeDisabled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("renders executed trade and watchlist actions as inline chips", async () => {
    const user = userEvent.setup();
    chat.mockResolvedValue(
      reply({
        message: "Done — bought 5 NVDA and added PYPL.",
        actions: [
          {
            type: "trade",
            status: "executed",
            ticker: "NVDA",
            detail: "Filled at market",
            side: "buy",
            quantity: 5,
            price: 900.5,
          },
          {
            type: "watchlist",
            status: "executed",
            ticker: "PYPL",
            detail: "Added to watchlist",
            action: "add",
          },
        ],
      }),
    );

    const { state } = renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.type(input(), "buy 5 nvda and watch pypl{Enter}");

    expect(await screen.findByText("BUY 5 NVDA @ $900.50")).toBeInTheDocument();
    expect(screen.getByText("ADD PYPL")).toBeInTheDocument();
    expect(screen.getByText("Filled at market")).toBeInTheDocument();
    // An executed action changed server state, so the terminal must refetch.
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(1));
  });

  it("marks a failed action and does not refetch for it", async () => {
    const user = userEvent.setup();
    chat.mockResolvedValue(
      reply({
        message: "That would cost more than your cash balance.",
        actions: [
          {
            type: "trade",
            status: "failed",
            ticker: "AAPL",
            detail: "Insufficient cash",
            side: "buy",
            quantity: 1_000,
            price: null,
          },
        ],
      }),
    );

    const { state } = renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.type(input(), "buy 1000 aapl{Enter}");

    expect(await screen.findByText("BUY 1,000 AAPL")).toBeInTheDocument();
    expect(screen.getByText("Insufficient cash")).toBeInTheDocument();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("shows a notice instead of crashing when the assistant errors", async () => {
    const user = userEvent.setup();
    chat.mockRejectedValue(new ApiError("Upstream model timed out", 502));
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.type(input(), "hello{Enter}");

    expect(await screen.findByText("Upstream model timed out")).toBeInTheDocument();
    expect(input()).toBeEnabled();
  });

  it("translates a 404 from the chat endpoint into a plain-language notice", async () => {
    const user = userEvent.setup();
    chat.mockRejectedValue(new ApiError("Not Found", 404));
    renderWithTerminal(<ChatPanel open onToggle={vi.fn()} />);

    await user.type(input(), "hello{Enter}");

    expect(await screen.findByText("AI assistant is not connected yet.")).toBeInTheDocument();
  });
});
