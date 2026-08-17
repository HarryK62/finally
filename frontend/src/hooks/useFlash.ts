"use client";

/**
 * Price-flash driver: watch a number, and for ~500ms after it moves report the
 * direction it moved in.
 *
 * The returned `flashKey` exists because CSS animations do not restart when the
 * same class is re-applied. Ticks arrive every 500ms — exactly the animation
 * duration — so consumers put `flashKey` on the animated element's `key` and
 * React remounts it, replaying the animation from the top every time.
 */

import { useEffect, useRef, useState } from "react";

export interface Flash {
  /** `"flash-up"`, `"flash-down"`, or `""` when nothing is flashing. */
  className: string;
  flashKey: number;
}

const FLASH_MS = 500;

export function useFlash(value: number | null | undefined): Flash {
  const previous = useRef<number | null>(null);
  const [flash, setFlash] = useState<Flash>({ className: "", flashKey: 0 });

  useEffect(() => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;

    const last = previous.current;
    previous.current = value;

    // The first price to arrive is not a change, so it must not flash.
    if (last === null || last === value) return;

    setFlash((current) => ({
      className: value > last ? "flash-up" : "flash-down",
      flashKey: current.flashKey + 1,
    }));

    const timer = window.setTimeout(
      () => setFlash((current) => ({ ...current, className: "" })),
      FLASH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [value]);

  return flash;
}
