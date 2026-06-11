import { describe, it, expect } from "vitest";
import type { Conversation } from "@/hooks/useConversations";
import {
  buildElicitationMap,
  buildStatusMap,
  computeUnreadSet,
  detectIdleTransitions,
  detectNewElicitations,
  type ConversationStatus,
} from "./idleTransitions";

function conv(id: string, status?: Conversation["status"]): Conversation {
  return {
    id,
    object: "conversation",
    title: id,
    created_at: 0,
    updated_at: 0,
    labels: {},
    permission_level: null,
    status,
  };
}

function statusMap(entries: Record<string, ConversationStatus>): Map<string, ConversationStatus> {
  return new Map(Object.entries(entries));
}

describe("buildStatusMap", () => {
  it("keys each conversation's status by id", () => {
    const map = buildStatusMap([conv("a", "running"), conv("b", "idle")]);
    expect(map.get("a")).toBe("running");
    expect(map.get("b")).toBe("idle");
  });

  it("omits conversations with undefined status", () => {
    const map = buildStatusMap([conv("a"), conv("b", "idle")]);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe("idle");
  });
});

describe("detectIdleTransitions", () => {
  it("detects running -> idle", () => {
    const prev = statusMap({ a: "running" });
    const result = detectIdleTransitions(prev, [conv("a", "idle")]);
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("detects running -> failed", () => {
    const prev = statusMap({ a: "running" });
    const result = detectIdleTransitions(prev, [conv("a", "failed")]);
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("ignores conversations that were not previously running", () => {
    // Was already idle — a poll refresh must not re-notify.
    const prev = statusMap({ a: "idle" });
    expect(detectIdleTransitions(prev, [conv("a", "idle")])).toEqual([]);
  });

  it("ignores conversations with no prior snapshot (fresh load)", () => {
    expect(detectIdleTransitions(new Map(), [conv("a", "idle")])).toEqual([]);
  });

  it("ignores conversations still running", () => {
    const prev = statusMap({ a: "running" });
    expect(detectIdleTransitions(prev, [conv("a", "running")])).toEqual([]);
  });

  it("ignores transitions to undefined status", () => {
    const prev = statusMap({ a: "running" });
    expect(detectIdleTransitions(prev, [conv("a")])).toEqual([]);
  });

  it("returns only the newly-finished conversations from a mixed list", () => {
    const prev = statusMap({ a: "running", b: "running", c: "idle" });
    const result = detectIdleTransitions(prev, [
      conv("a", "idle"), // finished
      conv("b", "running"), // still working
      conv("c", "idle"), // unchanged
      conv("d", "idle"), // brand new, no prior status
    ]);
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("detectNewElicitations", () => {
  function convE(id: string, count: number): Conversation {
    return {
      id,
      object: "conversation",
      title: id,
      created_at: 0,
      updated_at: 0,
      labels: {},
      permission_level: null,
      pending_elicitations_count: count,
    };
  }

  it("detects a 0 -> 1 increase (agent newly asks for input)", () => {
    const prev = new Map([["a", 0]]);
    // Previous count 0, now 1 -> a genuine new prompt, must fire.
    expect(detectNewElicitations(prev, [convE("a", 1)]).map((c) => c.id)).toEqual(["a"]);
  });

  it("detects an increase across more than one (1 -> 3)", () => {
    const prev = new Map([["a", 1]]);
    // A second and third prompt arrived between polls; still a single fire
    // for the session (the hook de-dupes per id, not per count).
    expect(detectNewElicitations(prev, [convE("a", 3)]).map((c) => c.id)).toEqual(["a"]);
  });

  it("ignores a session with no prior snapshot (fresh load)", () => {
    // No previous entry -> a page load with already-pending prompts must not
    // fire, mirroring the idle fresh-load behavior.
    expect(detectNewElicitations(new Map(), [convE("a", 2)])).toEqual([]);
  });

  it("ignores a steady elicitation count", () => {
    const prev = new Map([["a", 2]]);
    expect(detectNewElicitations(prev, [convE("a", 2)])).toEqual([]);
  });

  it("ignores a decrease (the user answered a prompt)", () => {
    const prev = new Map([["a", 2]]);
    // Count dropped 2 -> 1: the user resolved one; not a new ask, must not fire.
    expect(detectNewElicitations(prev, [convE("a", 1)])).toEqual([]);
  });

  it("treats missing count as 0", () => {
    const prev = new Map([["a", 0]]);
    const conv = { ...convE("a", 0), pending_elicitations_count: undefined };
    expect(detectNewElicitations(prev, [conv])).toEqual([]);
  });
});

describe("buildElicitationMap", () => {
  function convE(id: string, count?: number): Conversation {
    return {
      id,
      object: "conversation",
      title: id,
      created_at: 0,
      updated_at: 0,
      labels: {},
      permission_level: null,
      pending_elicitations_count: count,
    };
  }

  it("keys each conversation's elicitation count by id", () => {
    const map = buildElicitationMap([convE("a", 2), convE("b", 0)]);
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(0);
  });

  it("defaults a missing count to 0 (so a later 0 -> n increase can fire)", () => {
    // A session present with undefined count must seed as 0, not be absent —
    // otherwise detectNewElicitations would treat its first real count as a
    // fresh load and never fire.
    const map = buildElicitationMap([convE("a")]);
    expect(map.get("a")).toBe(0);
  });
});

describe("computeUnreadSet", () => {
  it("adds an attention id when no conversation is active", () => {
    const next = computeUnreadSet(new Set(), ["a"], undefined, true);
    expect([...next]).toEqual(["a"]);
  });

  it("adds an attention id for a non-active conversation while focused", () => {
    // Window focused but viewing 'b' -> 'a' is unread.
    const next = computeUnreadSet(new Set(), ["a"], "b", true);
    expect([...next]).toEqual(["a"]);
  });

  it("suppresses an attention id only when actively viewed (focused + active)", () => {
    // Focused AND viewing 'a' -> the user is looking at it, so not unread.
    const next = computeUnreadSet(new Set(), ["a"], "a", true);
    expect(next.has("a")).toBe(false);
  });

  it("marks the open conversation unread when the window is blurred", () => {
    // Active conversation is 'a' but the window is blurred -> the user isn't
    // looking, so an attention event on 'a' still counts as unread. This is
    // the core fix: badge tracks unread even with the window focused elsewhere.
    const next = computeUnreadSet(new Set(), ["a"], "a", false);
    expect(next.has("a")).toBe(true);
  });

  it("clears the actively-viewed conversation from an existing set", () => {
    // 'a' was unread; the user focuses the window on 'a' (no new attention
    // ids) -> 'a' is marked read and removed.
    const next = computeUnreadSet(new Set(["a", "b"]), [], "a", true);
    expect([...next].sort()).toEqual(["b"]);
  });

  it("does not clear the active conversation when the window is blurred", () => {
    // Refocus path requires focus; a blurred 'focus' can't happen, but guard
    // the logic: blurred + active 'a' leaves 'a' in the set.
    const next = computeUnreadSet(new Set(["a"]), [], "a", false);
    expect(next.has("a")).toBe(true);
  });

  it("does not mutate the input set", () => {
    const current = new Set(["a"]);
    computeUnreadSet(current, ["b"], undefined, true);
    // Original must be untouched (returns a new set).
    expect([...current]).toEqual(["a"]);
  });

  it("simultaneously adds non-active ids and clears the active one", () => {
    // Real-world tick: 'b' and 'c' finished while focused on 'a' -> add both,
    // and 'a' (actively viewed) is cleared.
    const next = computeUnreadSet(new Set(["a"]), ["b", "c"], "a", true);
    expect([...next].sort()).toEqual(["b", "c"]);
  });
});
