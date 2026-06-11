import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPanelSizePreference } from "@/lib/panelSizePreferences";
import { resetWidthStoreForTesting, useResizableInlinePanel } from "./useResizableInlinePanel";

// useResizableInlinePanel keeps its width in a module-level store shared across
// all callers. resetWidthStoreForTesting resets it to null between tests so
// cases are fully independent. A 2000px viewport gives a 1200px clamp ceiling
// (2000 * 0.6).

const originalInnerWidth = window.innerWidth;

function setInnerWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px });
}

// Simulate a manual resize via the public keyboard handle (ArrowLeft widens by
// 20px). Returns the resulting panelWidth.
function nudgeWiderOnce(result: { current: ReturnType<typeof useResizableInlinePanel> }): number {
  act(() =>
    result.current.handleProps.onKeyDown({
      key: "ArrowLeft",
      preventDefault: () => {},
    } as React.KeyboardEvent),
  );
  return result.current.panelWidth;
}

beforeEach(() => {
  setInnerWidth(2000);
});

afterEach(() => {
  localStorage.clear();
  resetWidthStoreForTesting();
  setInnerWidth(originalInnerWidth);
});

describe("useResizableInlinePanel persistence", () => {
  it("persists explicit keyboard resize and restores it after store reset", () => {
    const { result, unmount } = renderHook(() => useResizableInlinePanel());

    const afterNudge = nudgeWiderOnce(result);
    expect(afterNudge).toBe(480);
    expect(readPanelSizePreference("inlinePanelWidthPx")).toBe(480);

    unmount();
    resetWidthStoreForTesting();
    const restored = renderHook(() => useResizableInlinePanel());

    // The saved manual width wins over the viewport-derived default of 460.
    expect(restored.result.current.panelWidth).toBe(480);
    restored.unmount();
  });

  it("re-derives from the preference on resize: clamps down on shrink, springs back on widen", () => {
    const { result } = renderHook(() => useResizableInlinePanel());

    // Establish a persisted preference of 480 (default 460 + one ArrowLeft step).
    expect(nudgeWiderOnce(result)).toBe(480);
    expect(readPanelSizePreference("inlinePanelWidthPx")).toBe(480);

    // Shrinking the viewport clamps the live width to the 0.6 ceiling
    // (700 * 0.6 = 420) without disturbing the saved 480 preference.
    setInnerWidth(700);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current.panelWidth).toBe(420);
    expect(readPanelSizePreference("inlinePanelWidthPx")).toBe(480);

    // Widening again re-derives from the preference, restoring 480 in-session.
    setInnerWidth(2000);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current.panelWidth).toBe(480);
  });
});
