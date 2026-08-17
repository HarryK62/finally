import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, apiUrl } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The single URL of the last fetch call. */
function lastUrl(): string {
  return String(fetchMock.mock.calls.at(-1)?.[0]);
}

function lastInit(): RequestInit | undefined {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
}

describe("apiUrl", () => {
  it("emits a same-origin relative path (contract §8)", () => {
    expect(apiUrl("/api/health")).toBe("/api/health");
    expect(apiUrl("/api/portfolio")).toBe("/api/portfolio");
  });
});

describe("api requests", () => {
  it("hits relative paths with no host or port anywhere", async () => {
    // A Response body can only be read once, so mint a fresh one per call.
    fetchMock.mockImplementation(async () => jsonResponse({ status: "ok" }));

    await api.health();
    await api.portfolio();
    await api.watchlist();
    await api.history(120);
    await api.chatHistory(10);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "/api/health",
      "/api/portfolio",
      "/api/watchlist",
      "/api/portfolio/history?limit=120",
      "/api/chat/history?limit=10",
    ]);
    for (const url of urls) expect(url).not.toMatch(/^https?:|localhost|:8000/);
  });

  it("posts a trade as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trade: {} }));

    await api.trade("aapl", 2.5, "buy");

    expect(lastUrl()).toBe("/api/portfolio/trade");
    expect(lastInit()?.method).toBe("POST");
    expect(lastInit()?.body).toBe(JSON.stringify({ ticker: "aapl", quantity: 2.5, side: "buy" }));
    expect(lastInit()?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("posts a watchlist addition and url-encodes a removal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ticker: "PYPL" }));
    await api.addTicker("PYPL");
    expect(lastUrl()).toBe("/api/watchlist");
    expect(lastInit()?.method).toBe("POST");

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.removeTicker("BRK B");
    expect(lastUrl()).toBe("/api/watchlist/BRK%20B");
    expect(lastInit()?.method).toBe("DELETE");
  });

  it("resolves 204 responses without trying to parse a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.removeTicker("AAPL")).resolves.toBeUndefined();
  });

  it("surfaces the FastAPI detail string on an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Insufficient cash" }, 400));

    await expect(api.trade("AAPL", 1, "buy")).rejects.toMatchObject({
      name: "ApiError",
      message: "Insufficient cash",
      status: 400,
    });
  });

  it("unwraps the first message of a 422 validation detail array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: [{ msg: "quantity must be greater than 0" }] }, 422),
    );

    await expect(api.trade("AAPL", 0, "buy")).rejects.toThrow(
      "quantity must be greater than 0",
    );
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

    await expect(api.portfolio()).rejects.toThrow("Request failed (502)");
  });

  it("reports an unreachable server as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await api.portfolio().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toBe("Cannot reach the server");
  });
});
