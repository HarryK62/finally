import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionDot } from "./ConnectionDot";
import type { ConnectionStatus } from "@/hooks/usePriceStream";

/** Contract §8: green = open, yellow = reconnecting, red = errored/closed. */
const CASES: { status: ConnectionStatus; label: string; dotClass: string }[] = [
  { status: "open", label: "LIVE", dotClass: "bg-up" },
  { status: "connecting", label: "CONNECTING", dotClass: "bg-accent" },
  { status: "reconnecting", label: "RECONNECTING", dotClass: "bg-accent" },
  { status: "closed", label: "OFFLINE", dotClass: "bg-down" },
];

function dot(): HTMLElement {
  const indicator = screen.getByTestId("connection-status");
  const span = indicator.querySelector("span[aria-hidden]");
  if (!span) throw new Error("no dot rendered");
  return span as HTMLElement;
}

describe("ConnectionDot", () => {
  it.each(CASES)("maps $status to $dotClass with the $label label", ({
    status,
    label,
    dotClass,
  }) => {
    render(<ConnectionDot status={status} />);

    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", status);
    expect(dot()).toHaveClass(dotClass);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("never conveys state by colour alone", () => {
    for (const { status, label } of CASES) {
      const { unmount } = render(<ConnectionDot status={status} />);
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByTestId("connection-status")).toHaveAttribute(
        "title",
        `Price stream: ${label.toLowerCase()}`,
      );
      unmount();
    }
  });

  it("pulses only while a connection is pending", () => {
    const { unmount } = render(<ConnectionDot status="reconnecting" />);
    expect(dot()).toHaveClass("pulse-dot");
    unmount();

    render(<ConnectionDot status="open" />);
    expect(dot()).not.toHaveClass("pulse-dot");
  });
});
