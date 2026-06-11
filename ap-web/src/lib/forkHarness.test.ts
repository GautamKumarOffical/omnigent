import { describe, it, expect } from "vitest";
import { harnessFamily, isNativeHarness, forkSwitchPreservesHistory } from "./forkHarness";

describe("harnessFamily", () => {
  it.each([
    ["claude-native", "anthropic"],
    ["native-claude", "anthropic"],
    ["claude-sdk", "anthropic"],
    ["claude_sdk", "anthropic"],
    ["codex", "openai"],
    ["codex-native", "openai"],
    ["native-codex", "openai"],
    ["openai-agents", "openai"],
    ["openai-agents-sdk", "openai"],
    ["agents_sdk", "openai"],
  ])("maps %s → %s", (harness, family) => {
    expect(harnessFamily(harness)).toBe(family);
  });

  it.each([["mystery"], [null], [undefined], [""]])(
    "returns null for unknown/empty %s",
    (harness) => {
      expect(harnessFamily(harness as string | null | undefined)).toBeNull();
    },
  );
});

describe("isNativeHarness", () => {
  it.each([
    ["claude-native", true],
    ["native-claude", true],
    ["codex-native", true],
    ["native-codex", true],
    ["claude-sdk", false],
    ["claude_sdk", false],
    ["openai-agents", false],
    ["codex", false],
    [null, false],
  ])("classifies %s as native=%s", (harness, expected) => {
    expect(isNativeHarness(harness as string | null)).toBe(expected);
  });
});

describe("forkSwitchPreservesHistory", () => {
  // SDK targets always carry history as context, regardless of source or
  // family — including native → SDK and cross-family. A false here would
  // wrongly hide a fully-supported switch from the picker.
  it.each([
    ["claude-native", "claude-sdk"], // native → same-family SDK
    ["codex-native", "openai-agents"], // native → same-family SDK
    ["claude-sdk", "codex"], // cross-family SDK → SDK (codex SDK)
    ["openai-agents", "claude-sdk"], // cross-family → SDK
  ])("SDK target %s ← %s preserves history", (source, target) => {
    expect(forkSwitchPreservesHistory(source, target)).toBe(true);
  });

  // claude-native target: the runner rebuilds the Claude transcript from
  // the copied Omnigent items, so ANY source carries — same-family (clone
  // or rebuild) and cross-family (rebuild) alike.
  it.each([
    ["claude-sdk", "claude-native"], // same-family SDK (rebuild)
    ["claude-native", "claude-native"], // same-family native (clone)
    ["openai-agents", "claude-native"], // cross-family SDK (rebuild)
    ["codex-native", "claude-native"], // cross-family native (rebuild)
  ])("claude-native target %s ← %s preserves history", (source, target) => {
    expect(forkSwitchPreservesHistory(source, target)).toBe(true);
  });

  // codex-native target: same-family sources carry (clone for a codex
  // source, rebuild for an openai SDK source — today's behavior).
  it.each([
    ["codex", "codex-native"], // codex SDK → native (rebuild)
    ["openai-agents", "codex-native"], // SDK → native (rebuild)
    ["codex-native", "codex-native"], // native → native (clone)
  ])("same-family codex-native target %s ← %s preserves history", (source, target) => {
    expect(forkSwitchPreservesHistory(source, target)).toBe(true);
  });

  // Cross-family into codex-native is hidden: the rollout synthesizer
  // doesn't track Codex's session_meta schema yet (codex ≥ 0.136 rejects
  // the synthesized rollout), so the rebuild would silently start fresh.
  // A true here would surface a silently-fresh switch in the picker.
  it.each([
    ["claude-sdk", "codex-native"], // anthropic SDK → openai native
    ["claude-native", "codex-native"], // anthropic native → openai native
    ["mystery", "codex-native"], // unknown source can't match the family
  ])("cross-family codex-native target %s ← %s loses history", (source, target) => {
    expect(forkSwitchPreservesHistory(source, target)).toBe(false);
  });

  it("does NOT offer a target whose harness is unknown (conservative; see TODO)", () => {
    // We can't classify an unrecognised harness (the catalog may report
    // harness=null when it couldn't load the agent's bundle), so we don't
    // offer a switch we can't verify preserves history.
    expect(forkSwitchPreservesHistory("claude-sdk", "mystery")).toBe(false);
    expect(forkSwitchPreservesHistory("claude-sdk", null)).toBe(false);
    expect(forkSwitchPreservesHistory("claude-native", undefined)).toBe(false);
  });
});
