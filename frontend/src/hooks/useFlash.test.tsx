import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFlash } from "./useFlash";

/** Renders the flash state so assertions read off the DOM, as components do. */
function Probe({ value }: { value: number | null | undefined }) {
  const flash = useFlash(value);
  return (
    <span
      data-testid="cell"
      data-flash-key={flash.flashKey}
      className={flash.className}
    >
      {value ?? "—"}
    </span>
  );
}

const cell = () => screen.getByTestId("cell");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFlash", () => {
  it("does not flash on the first price", () => {
    render(<Probe value={190} />);
    expect(cell().className).toBe("");
  });

  it("flashes green on an uptick", () => {
    const { rerender } = render(<Probe value={190} />);
    act(() => {
      rerender(<Probe value={191} />);
    });
    expect(cell()).toHaveClass("flash-up");
  });

  it("flashes red on a downtick", () => {
    const { rerender } = render(<Probe value={190} />);
    act(() => {
      rerender(<Probe value={189.5} />);
    });
    expect(cell()).toHaveClass("flash-down");
  });

  it("does not flash when the price repeats", () => {
    const { rerender } = render(<Probe value={190} />);
    act(() => {
      rerender(<Probe value={190} />);
    });
    expect(cell().className).toBe("");
  });

  it("clears the flash after ~500ms", () => {
    const { rerender } = render(<Probe value={190} />);
    act(() => {
      rerender(<Probe value={191} />);
    });
    expect(cell()).toHaveClass("flash-up");

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(cell()).toHaveClass("flash-up");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(cell().className).toBe("");
  });

  it("bumps flashKey on every move so the CSS animation restarts", () => {
    const { rerender } = render(<Probe value={190} />);
    const first = cell().dataset.flashKey;

    act(() => {
      rerender(<Probe value={191} />);
    });
    const second = cell().dataset.flashKey;

    act(() => {
      rerender(<Probe value={192} />);
    });
    const third = cell().dataset.flashKey;

    expect(Number(second)).toBe(Number(first) + 1);
    expect(Number(third)).toBe(Number(second) + 1);
  });

  it("switches direction mid-flash without waiting for the timer", () => {
    const { rerender } = render(<Probe value={190} />);
    act(() => {
      rerender(<Probe value={191} />);
    });
    act(() => {
      vi.advanceTimersByTime(200);
      rerender(<Probe value={190.5} />);
    });
    expect(cell()).toHaveClass("flash-down");
  });

  it("ignores null and non-finite values, then flashes off the first real move", () => {
    const { rerender } = render(<Probe value={null} />);
    expect(cell().className).toBe("");

    act(() => {
      rerender(<Probe value={Number.NaN} />);
    });
    expect(cell().className).toBe("");

    // 190 is the first usable price, so it is a baseline and must not flash.
    act(() => {
      rerender(<Probe value={190} />);
    });
    expect(cell().className).toBe("");

    act(() => {
      rerender(<Probe value={195} />);
    });
    expect(cell()).toHaveClass("flash-up");
  });
});
