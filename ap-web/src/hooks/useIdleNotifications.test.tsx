import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
// The hook consumes `useNavigate` from the routing IoC seam (@/lib/routing),
// not react-router-dom directly, so mock the seam. Mocking react-router-dom
// instead breaks because @/lib/routing imports other primitives (useParams, …)
// from it that this partial mock wouldn't provide.
vi.mock("@/lib/routing", () => ({ useNavigate: () => navigateMock }));

vi.mock("@/hooks/useConversations", () => ({ useConversations: vi.fn() }));

vi.mock("@/lib/browserNotifications", () => ({
  getNotificationPermission: vi.fn(),
  requestNotificationPermission: vi.fn(),
  showNotification: vi.fn(),
}));

// The native bridge is mocked so we can assert badge calls and toggle the
// "running inside the desktop shell" discriminator without a real Electron env.
vi.mock("@/lib/nativeBridge", () => ({
  isNativeShell: vi.fn(),
  setBadgeCount: vi.fn().mockResolvedValue(undefined),
}));

// The turn-end notification body is enriched by an async fetch of the agent's
// final message text. Mock it so tests don't hit the network; default to
// `undefined` so the body falls back to the generic IDLE_BODY the existing
// assertions expect. Specific tests override the resolved value.
vi.mock("@/lib/lastAssistantText", () => ({
  fetchLastAssistantText: vi.fn().mockResolvedValue(undefined),
}));

import { useConversations } from "@/hooks/useConversations";
import type { Conversation } from "@/hooks/useConversations";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
} from "@/lib/browserNotifications";
import { isNativeShell, setBadgeCount } from "@/lib/nativeBridge";
import { fetchLastAssistantText } from "@/lib/lastAssistantText";
import { useIdleNotifications } from "./useIdleNotifications";

const useConvMock = vi.mocked(useConversations);
const getPermMock = vi.mocked(getNotificationPermission);
const requestPermMock = vi.mocked(requestNotificationPermission);
const showMock = vi.mocked(showNotification);
const isNativeMock = vi.mocked(isNativeShell);
const setBadgeMock = vi.mocked(setBadgeCount);
const fetchPreviewMock = vi.mocked(fetchLastAssistantText);

/**
 * Flush pending microtasks so the async turn-end notification path (preview
 * fetch -> showNotification) resolves before assertions. The idle branch
 * fires the toast inside a resolved promise; the elicitation path is
 * synchronous and doesn't need this.
 */
async function flushPreview(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function conv(
  id: string,
  status: Conversation["status"],
  pendingElicitations = 0,
): Conversation {
  return {
    id,
    object: "conversation",
    title: id,
    created_at: 0,
    updated_at: 0,
    labels: {},
    permission_level: null,
    status,
    pending_elicitations_count: pendingElicitations,
  };
}

/** Shape a conversations list into the useConversations return value. */
function setConversations(list: Conversation[]): void {
  useConvMock.mockReturnValue({
    data: { pages: [{ data: list }] },
  } as unknown as ReturnType<typeof useConversations>);
}

/** Force the window-focus reading used by the hook (document.hasFocus). */
function setWindowFocused(focused: boolean): void {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
}


beforeEach(() => {
  navigateMock.mockReset();
  showMock.mockReset();
  requestPermMock.mockReset();
  setBadgeMock.mockClear();
  fetchPreviewMock.mockReset();
  fetchPreviewMock.mockResolvedValue(undefined);
  getPermMock.mockReturnValue("granted");
  isNativeMock.mockReturnValue(false);
  // Default: window NOT focused, so attention events surface (the common
  // "user looked away" case). Focus-specific tests override this.
  setWindowFocused(false);
  setConversations([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useIdleNotifications turn-end transitions", () => {
  it("notifies when a session goes running -> idle while not actively viewed", async () => {
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());

    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();

    // running -> idle on an unviewed session must fire exactly one toast.
    expect(showMock).toHaveBeenCalledOnce();
    expect(showMock.mock.calls[0][0]).toMatchObject({
      title: "a",
      body: "Agent finished and is ready for your input.",
      tag: "omnigent:session:a",
    });
  });

  it("uses the agent's final message text as the body when available", async () => {
    fetchPreviewMock.mockResolvedValue("Fixed the badge bug and shipped it.");
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());

    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();

    // The preview text replaces the generic body; fetched for this session.
    expect(fetchPreviewMock).toHaveBeenCalledWith("a");
    expect(showMock.mock.calls[0][0]).toMatchObject({
      title: "a",
      body: "Fixed the badge bug and shipped it.",
    });
  });

  it("navigates to the conversation when the notification is clicked", async () => {
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());
    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();

    showMock.mock.calls[0][0].onClick?.();
    // Click routes to the session's chat page.
    expect(navigateMock).toHaveBeenCalledWith("/c/a");
  });

  it("does not notify on a fresh load with already-idle sessions", () => {
    setConversations([conv("a", "idle")]);
    renderHook(() => useIdleNotifications());
    expect(showMock).not.toHaveBeenCalled();
  });

  it("does not notify on a steady-state idle refresh", async () => {
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());
    setConversations([conv("a", "idle")]);
    rerender();
    // Flush the first transition's async toast before clearing, else its
    // late-resolving notification would leak into the post-clear assertion.
    await flushPreview();
    showMock.mockClear();

    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();
    expect(showMock).not.toHaveBeenCalled();
  });
});

describe("useIdleNotifications elicitation transitions", () => {
  it("notifies when pending_elicitations_count increases (0 -> 1)", () => {
    setConversations([conv("a", "running", 0)]);
    const { rerender } = renderHook(() => useIdleNotifications());

    setConversations([conv("a", "running", 1)]);
    rerender();

    // A new elicitation on a running session is an "asks for input" event.
    expect(showMock).toHaveBeenCalledOnce();
    expect(showMock.mock.calls[0][0]).toMatchObject({
      title: "a",
      body: "Agent is asking for your input.",
      tag: "omnigent:session:a",
    });
  });

  it("does not notify on a fresh load with already-pending elicitations", () => {
    setConversations([conv("a", "running", 2)]);
    renderHook(() => useIdleNotifications());
    expect(showMock).not.toHaveBeenCalled();
  });

  it("fires a single toast when a turn ends and an elicitation arrives together", async () => {
    setConversations([conv("a", "running", 0)]);
    const { rerender } = renderHook(() => useIdleNotifications());

    // Same tick: status running -> idle AND elicitation 0 -> 1. The hook must
    // de-dupe to one toast for the session (the idle branch wins).
    setConversations([conv("a", "idle", 1)]);
    rerender();
    await flushPreview();

    expect(showMock).toHaveBeenCalledOnce();
    expect(showMock.mock.calls[0][0]).toMatchObject({
      body: "Agent finished and is ready for your input.",
    });
  });
});

describe("useIdleNotifications active-view suppression", () => {
  it("does NOT notify a turn end for the conversation actively viewed (focused + active)", () => {
    setWindowFocused(true);
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications("a"));

    setConversations([conv("a", "idle")]);
    rerender();
    // Window focused AND viewing 'a' -> the user is looking at it; suppress.
    expect(showMock).not.toHaveBeenCalled();
  });

  it("DOES notify a turn end for a non-active conversation even when focused", async () => {
    setWindowFocused(true);
    setConversations([conv("a", "running"), conv("b", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications("a"));

    // 'b' finishes while the user is focused on 'a' -> still notify for 'b'.
    setConversations([conv("a", "running"), conv("b", "idle")]);
    rerender();
    await flushPreview();
    expect(showMock).toHaveBeenCalledOnce();
    expect(showMock.mock.calls[0][0]).toMatchObject({ title: "b" });
  });

  it("DOES notify the open conversation when the window is blurred", async () => {
    setWindowFocused(false);
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications("a"));

    // Viewing 'a' but window blurred -> the user isn't looking, so notify.
    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();
    expect(showMock).toHaveBeenCalledOnce();
  });
});

describe("useIdleNotifications badge (native shell)", () => {
  beforeEach(() => {
    isNativeMock.mockReturnValue(true);
  });

  it("sets the badge to the count of unread sessions on a turn end", () => {
    setWindowFocused(false);
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());
    setBadgeMock.mockClear();

    setConversations([conv("a", "idle")]);
    rerender();

    // One unread session -> badge count 1. If 0, the unread set isn't being
    // populated; if >1, ids are being double-counted.
    expect(setBadgeMock).toHaveBeenCalledWith(1);
  });

  it("accumulates distinct unread sessions across polls", () => {
    setWindowFocused(false);
    setConversations([conv("a", "running"), conv("b", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());

    setConversations([conv("a", "idle"), conv("b", "running")]);
    rerender();
    setConversations([conv("a", "idle"), conv("b", "idle")]);
    rerender();

    // Two separate sessions finished across two polls -> badge reaches 2.
    expect(setBadgeMock).toHaveBeenLastCalledWith(2);
  });

  it("clears the badge when the window regains focus on the open conversation", () => {
    setWindowFocused(false);
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications("a"));
    setConversations([conv("a", "idle")]);
    rerender();
    // Precondition: 'a' is unread (badge 1).
    expect(setBadgeMock).toHaveBeenLastCalledWith(1);
    setBadgeMock.mockClear();

    // User refocuses the window while 'a' is the active conversation.
    setWindowFocused(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Focusing on the open conversation marks it read -> badge clears to 0.
    expect(setBadgeMock).toHaveBeenCalledWith(0);
  });

  it("keeps other unread sessions when focusing clears only the active one", () => {
    setWindowFocused(false);
    setConversations([conv("a", "running"), conv("b", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications("a"));
    setConversations([conv("a", "idle"), conv("b", "idle")]);
    rerender();
    // Both unread -> badge 2.
    expect(setBadgeMock).toHaveBeenLastCalledWith(2);
    setBadgeMock.mockClear();

    setWindowFocused(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Focusing on 'a' clears only 'a'; 'b' remains unread -> badge 1.
    expect(setBadgeMock).toHaveBeenCalledWith(1);
  });
});

describe("useIdleNotifications gating", () => {
  it("does not notify when web permission is not granted (browser)", () => {
    isNativeMock.mockReturnValue(false);
    getPermMock.mockReturnValue("default");
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());
    setConversations([conv("a", "idle")]);
    rerender();
    // No grant in a plain browser -> no toast.
    expect(showMock).not.toHaveBeenCalled();
  });

  it("notifies under the desktop shell even when web permission is not granted", async () => {
    isNativeMock.mockReturnValue(true);
    getPermMock.mockReturnValue("default");
    setConversations([conv("a", "running")]);
    const { rerender } = renderHook(() => useIdleNotifications());
    setConversations([conv("a", "idle")]);
    rerender();
    await flushPreview();
    // Native shell manages permission downstream, so the web grant gate is
    // bypassed and the toast still fires.
    expect(showMock).toHaveBeenCalledOnce();
  });
});

describe("useIdleNotifications lazy permission request", () => {
  it("requests permission on the first user gesture when permission is default", () => {
    getPermMock.mockReturnValue("default");
    renderHook(() => useIdleNotifications());

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(requestPermMock).toHaveBeenCalledOnce();
  });

  it("does not request permission when already granted or denied", () => {
    getPermMock.mockReturnValue("granted");
    renderHook(() => useIdleNotifications());
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(requestPermMock).not.toHaveBeenCalled();
  });
});
