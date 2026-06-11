// Pure detection of a conversation finishing a turn (`running` →
// `idle`/`failed`).
//
// Split out from useIdleNotifications so the "which sessions newly
// changed" decision is unit-testable without React or the Notification
// global. The hook owns the previous-snapshot ref; this module only
// diffs two snapshots.

import type { Conversation } from "@/hooks/useConversations";

// Statuses that mean "the agent stopped working and is waiting on the
// user" — the moment worth surfacing. "running" is excluded (still
// working); "failed" is included (a stop the user should see).
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["idle", "failed"]);

export type ConversationStatus = NonNullable<Conversation["status"]>;

/** Snapshot of each conversation's last-known status, keyed by id. */
export function buildStatusMap(conversations: Conversation[]): Map<string, ConversationStatus> {
  const map = new Map<string, ConversationStatus>();
  for (const conversation of conversations) {
    if (conversation.status !== undefined) map.set(conversation.id, conversation.status);
  }
  return map;
}

/**
 * Conversations whose status went `running` → `idle`/`failed` between
 * the previous snapshot and the current list.
 *
 * Requiring the *previous* status to be exactly `running` means a fresh
 * page load (empty `previous`) fires nothing, and steady-state idle rows
 * never re-notify on a poll refresh — only a genuine finish does.
 */
export function detectIdleTransitions(
  previous: Map<string, ConversationStatus>,
  conversations: Conversation[],
): Conversation[] {
  return conversations.filter((conversation) => {
    const status = conversation.status;
    if (status === undefined || !TERMINAL_STATUSES.has(status)) return false;
    return previous.get(conversation.id) === "running";
  });
}


/** Snapshot of each conversation's pending-elicitation count, keyed by id. */
export function buildElicitationMap(conversations: Conversation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const conversation of conversations) {
    map.set(conversation.id, conversation.pending_elicitations_count ?? 0);
  }
  return map;
}

/**
 * Conversations whose pending-elicitation count *increased* between the
 * previous snapshot and the current list — i.e. the agent just raised a
 * new prompt asking the user for input.
 *
 * Requiring a previous entry (\`previous.has(id)\`) means a fresh page load
 * with already-pending elicitations fires nothing; only a genuine increase
 * observed by this client does. A 0 → 1 change fires (previous entry is 0);
 * a steady count or a decrease (the user answered) does not.
 */
export function detectNewElicitations(
  previous: Map<string, number>,
  conversations: Conversation[],
): Conversation[] {
  return conversations.filter((conversation) => {
    const current = conversation.pending_elicitations_count ?? 0;
    const prior = previous.get(conversation.id);
    return prior !== undefined && current > prior;
  });
}

/**
 * Pure reducer for the "unread sessions" set that drives the dock/taskbar
 * badge. Given the current set and this poll's observations, returns the
 * next set:
 *
 *   * Each \`attentionId\` (a session that just ended a turn or raised a new
 *     elicitation) is marked unread — UNLESS it's the conversation the user
 *     is actively viewing (the window is focused AND it's the active route).
 *     "Actively viewed" is the ONE suppression rule: if the window is
 *     blurred, even the open conversation counts as unread, because the user
 *     isn't looking at it.
 *   * The actively-viewed conversation is always cleared from the set, so
 *     opening (or refocusing on) a session marks it read.
 *
 * Returns a NEW set; never mutates \`current\`.
 *
 * :param current: The existing unread-session id set.
 * :param attentionIds: Ids needing attention this tick, e.g. \`["conv_a"]\`.
 * :param activeId: The conversation currently open in the UI, or undefined
 *   when on a non-chat route, e.g. \`"conv_a"\`.
 * :param windowFocused: Whether the app window itself has focus.
 * :returns: The next unread-session id set.
 */
export function computeUnreadSet(
  current: ReadonlySet<string>,
  attentionIds: string[],
  activeId: string | undefined,
  windowFocused: boolean,
): Set<string> {
  const next = new Set(current);
  const isActivelyViewed = (id: string): boolean => windowFocused && id === activeId;
  for (const id of attentionIds) {
    if (!isActivelyViewed(id)) next.add(id);
  }
  if (activeId !== undefined && isActivelyViewed(activeId)) next.delete(activeId);
  return next;
}
