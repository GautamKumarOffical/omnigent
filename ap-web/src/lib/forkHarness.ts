// Pure helpers for the "fork with a different agent" flow: decide which
// switch targets preserve the source's conversation history.
//
// Two mechanisms carry a fork's history, both keyed off the TARGET harness:
//   - SDK (non-native) harnesses replay the Omnigent transcript as LLM
//     context, so they always carry history regardless of the source.
//   - Native harnesses (Claude Code, Codex) do NOT replay the transcript;
//     the runner rebuilds their on-disk transcript before launch — cloning
//     the source's native transcript when the source is same-family native,
//     else building one from the copied Omnigent items (a format-agnostic
//     conversion, so the source harness doesn't matter).
//
// One exception: a CROSS-FAMILY switch into codex-native is hidden. The
// Codex rollout synthesizer doesn't track Codex's session_meta schema yet
// (codex ≥ 0.136 rejects the synthesized rollout as "does not start with
// session metadata"), so the rebuild silently launches fresh. Offer it
// again together with the version-aware synthesizer fix (see
// tests/e2e/test_host_cross_family_fork_e2e.py module docstring).
// Claude-native targets carry history from any source.

/** Provider family a harness consumes, or null when unknown. */
export function harnessFamily(harness: string | null | undefined): "anthropic" | "openai" | null {
  if (!harness) return null;
  switch (harness) {
    case "claude-native":
    case "native-claude":
    case "claude-sdk":
    case "claude_sdk":
      return "anthropic";
    case "codex":
    case "codex-native":
    case "native-codex":
    case "openai-agents":
    case "openai-agents-sdk":
    case "agents_sdk":
      return "openai";
    default:
      return null;
  }
}

/** Whether a harness is a native CLI harness (Claude Code / Codex). */
export function isNativeHarness(harness: string | null | undefined): boolean {
  return (
    harness === "claude-native" ||
    harness === "native-claude" ||
    harness === "codex-native" ||
    harness === "native-codex"
  );
}

/**
 * Whether switching a fork from `sourceHarness` to `targetHarness` keeps
 * the source's conversation history (and so should be offered in the
 * picker).
 *
 * Returns true when:
 *   - the target is a known SDK harness (it replays the transcript as
 *     context), regardless of the source or its family;
 *   - the target is claude-native (the runner rebuilds the Claude
 *     transcript from the copied Omnigent items for any source); or
 *   - the target is codex-native AND the source is in the openai family
 *     (clone for a codex source, rebuild for an openai SDK source).
 *
 * Returns false for a cross-family switch into codex-native (the Codex
 * rollout synthesizer doesn't track Codex's session_meta schema yet — the
 * rebuild would silently start fresh; see the module comment) and —
 * conservatively — for any target whose harness we can't classify.
 *
 * TODO(fork-switch): default false when the target harness is unknown
 * (`harnessFamily` returns null) — e.g. the catalog reports `harness: null`
 * because the server couldn't load the agent's bundle (see
 * `_to_agent_object` in `server/routes/builtin_agents.py`). We don't offer
 * a switch we can't verify preserves history. Revisit once the catalog
 * reliably reports a harness for every built-in, or to add an explicit
 * "may start fresh" affordance for unclassified harnesses.
 *
 * @param sourceHarness - The source session's harness.
 * @param targetHarness - The harness the fork would switch to.
 */
export function forkSwitchPreservesHistory(
  sourceHarness: string | null | undefined,
  targetHarness: string | null | undefined,
): boolean {
  const targetFamily = harnessFamily(targetHarness);
  // Unknown/unsupported target harness → don't offer it (see TODO above).
  if (targetFamily === null) return false;
  // Known SDK target replays the transcript as context: history carries
  // regardless of the source or its family (incl. native → SDK).
  if (!isNativeHarness(targetHarness)) return true;
  // Claude-native target: the runner rebuilds the Claude transcript from
  // the copied Omnigent items, so any source carries.
  if (targetFamily === "anthropic") return true;
  // Codex-native target: only a same-family source carries until the
  // rollout synthesizer tracks Codex's session_meta schema (see module
  // comment).
  return harnessFamily(sourceHarness) === targetFamily;
}
