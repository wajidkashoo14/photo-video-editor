"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * For long work (an export, a batch) that should keep going while the user looks at other pages.
 *
 * Next keeps up to 3 recently visited routes alive but hidden (React Activity). It runs their
 * effect cleanups when it hides them, so work stopped from an effect cleanup would end as soon as
 * another page opened. Instead, pass `attach` as the ref of an element on the page, and ask while
 * working:
 * - `hidden()`: another page is showing; this one is still alive, so carry on;
 * - `gone()`: the route was dropped and its DOM left the document; stop, and say so.
 */
export function usePageActivity() {
  const node = useRef<Element | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  const attach = useCallback((el: Element | null) => {
    if (el) node.current = el; // React passes null while the route is hidden; keep the element
  }, []);
  const hidden = useCallback(() => !shown.current, []);
  const gone = useCallback(() => node.current !== null && !node.current.isConnected, []);
  return { attach, hidden, gone };
}

/**
 * Reads a browser-only value (localStorage, feature detection) without a hydration mismatch:
 * the server and first client render use `serverValue`, then the real value takes over.
 * `read` must return a primitive (or a stable reference).
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noop, read, () => serverValue);
}
