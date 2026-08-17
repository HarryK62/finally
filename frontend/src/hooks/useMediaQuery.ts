"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Track a CSS media query from React.
 *
 * `serverValue` is what the prerendered export and the hydrating client both
 * see, so the static HTML never disagrees with the first client render; the
 * real match is adopted on the commit after hydration. Reading `matchMedia`
 * happens in the store callbacks, never during render.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}
