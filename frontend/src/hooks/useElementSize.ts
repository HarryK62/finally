"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Measure an element. The treemap needs real pixel dimensions — squarified
 * layout optimises for aspect ratio, so laying out in a unit box and stretching
 * to fit would defeat the whole point of the algorithm.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
