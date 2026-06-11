import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  isConversationUnseen,
  markConversationSeen,
  nowSeconds,
} from "./useUnseenConversations";

const STORAGE_KEY = "omnigent:last-seen-timestamps";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("markConversationSeen", () => {
  it("stores the current wall-clock time for a conversation", () => {
    vi.useFakeTimers({ now: 5_000_000 });
    markConversationSeen("conv-1");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["conv-1"]).toBe(5_000);
  });

  it("advances the timestamp on subsequent calls", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    vi.setSystemTime(2_000_000);
    markConversationSeen("conv-1");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["conv-1"]).toBe(2_000);
  });

  it("tracks multiple conversations independently", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    vi.setSystemTime(2_000_000);
    markConversationSeen("conv-2");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["conv-1"]).toBe(1_000);
    expect(stored["conv-2"]).toBe(2_000);
  });

  it("accepts an explicit `atSeconds` baseline (server-time anchor)", () => {
    // Anchoring to a server timestamp avoids client-clock skew false
    // positives after a self-initiated PATCH bumps server updated_at.
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1", 5_000);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["conv-1"]).toBe(5_000);
  });

  it("dismisses a same-second updated_at after explicit mark-seen", () => {
    // Real-world scenario: user renames an off-screen conversation;
    // server returns updated_at = T; we mark seen at T. The next
    // refetch shows updated_at = T, which is NOT greater than stored.
    markConversationSeen("conv-1", 5_000);
    expect(isConversationUnseen("conv-1", 5_000, "idle")).toBe(false);
  });

  it("does not move the baseline backwards when explicit atSeconds is older", () => {
    vi.useFakeTimers({ now: 10_000_000 });
    markConversationSeen("conv-1");
    markConversationSeen("conv-1", 5_000);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["conv-1"]).toBe(10_000);
  });
});

describe("nowSeconds", () => {
  it("returns Date.now() divided by 1000, floored", () => {
    vi.useFakeTimers({ now: 1_716_800_500 });
    expect(nowSeconds()).toBe(1_716_800);
  });
});

describe("isConversationUnseen", () => {
  it("returns false for a conversation with no stored baseline", () => {
    expect(isConversationUnseen("conv-1", 5000, "idle")).toBe(false);
  });

  it("returns false when status is running", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 2_000, "running")).toBe(false);
  });

  it("returns false when status is undefined", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 2_000, undefined)).toBe(false);
  });

  it("returns false when updated_at equals the stored timestamp", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 1_000, "idle")).toBe(false);
  });

  it("returns true when idle and updated_at exceeds stored", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 2_000, "idle")).toBe(true);
  });

  it("returns true when failed and updated_at exceeds stored", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 2_000, "failed")).toBe(true);
  });

  it("returns false when updated_at is older than stored", () => {
    vi.useFakeTimers({ now: 2_000_000 });
    markConversationSeen("conv-1");
    expect(isConversationUnseen("conv-1", 1_000, "idle")).toBe(false);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not valid json!!!");
    expect(isConversationUnseen("conv-1", 1000, "idle")).toBe(false);
  });

  it("handles non-object localStorage values gracefully", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(isConversationUnseen("conv-1", 1000, "idle")).toBe(false);
  });
});
