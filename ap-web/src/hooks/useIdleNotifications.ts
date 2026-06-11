// Surfaces "a session needs your attention" as OS notifications and a
// dock/taskbar badge. Rides the existing conversations poll (no new backend
// signal): each refresh we diff the previous snapshot and react to two
// "attention" transitions.
//
// Attention events (notify + badge):
//   * a turn finishing — status `running` -> `idle`/`failed`
//   * a new elicitation — `pending_elicitations_count` increased (the agent
//     is asking the user for input)
//
// The dock badge shows the number of UNREAD sessions at all times — sessions
// that had an attention event the user hasn't looked at yet. A session is
// "read" (removed from the badge) when the user is actively viewing it: the
// window is focused AND it's the open conversation. Notifications follow the
// same rule — anything that needs attention notifies, except the conversation
// you're actively looking at.
//
// Notifications are on by default — there's no settings toggle. In a plain
// browser the Web Notifications API still requires a permission grant, so we
// request it once, lazily, off the first genuine user gesture (prompting on
// load gets downgraded to Chrome's "quiet UI" and silently never appears).
// Granting permission is the opt-in; denying it is respected and never
// re-prompted. Under the Electron desktop shell the OS notification path
// manages permission, so that gate doesn't apply.

import { useEffect, useRef } from "react";
import { useNavigate } from "@/lib/routing";
import { useConversations } from "@/hooks/useConversations";
import type { Conversation } from "@/hooks/useConversations";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
} from "@/lib/browserNotifications";
import { isNativeShell, setBadgeCount } from "@/lib/nativeBridge";
import { fetchLastAssistantText } from "@/lib/lastAssistantText";
import {
  buildElicitationMap,
  buildStatusMap,
  computeUnreadSet,
  type ConversationStatus,
  detectIdleTransitions,
  detectNewElicitations,
} from "@/lib/idleTransitions";
import { conversationDisplayLabel } from "@/shell/sidebarNav";

const IDLE_BODY = "Agent finished and is ready for your input.";
const ELICITATION_BODY = "Agent is asking for your input.";

/**
 * Attach a one-shot listener that requests notification permission on the
 * first user gesture, then removes itself. Only prompts when the grant is
 * still `default` (never re-asks after grant or denial).
 */
function useLazyPermissionRequest(): void {
  useEffect(() => {
    if (getNotificationPermission() !== "default") return;
    const handler = () => {
      void requestNotificationPermission();
    };
    // `once` auto-removes the listener after it fires the first time.
    window.addEventListener("pointerdown", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);
}

/** True when the app window currently has focus (SSR-safe default true). */
function isWindowFocused(): boolean {
  if (typeof document === "undefined") return true;
  return typeof document.hasFocus === "function" ? document.hasFocus() : true;
}

/**
 * Watch the conversations list for sessions that need attention and surface
 * them as OS notifications plus a dock/taskbar badge. Mount once, app-wide.
 *
 * Surfaces a turn finishing (`running` → `idle`/`failed`) and a new
 * elicitation. The previous-snapshot refs seed from the first observed
 * value, so sessions already idle at load never fire — only a fresh
 * transition observed by this client does.
 *
 * The badge reflects the number of unread sessions — those that had an
 * attention event (turn finished or new elicitation) the user hasn't viewed.
 * It updates on every change, regardless of window focus, and clears a
 * session the moment the user actively views it.
 *
 * :param activeConversationId: The conversation currently open in the UI, or
 *   undefined on a non-chat route, e.g. ``"conv_abc123"``. Used to suppress
 *   the notification/badge for the session the user is actively viewing.
 */
export function useIdleNotifications(activeConversationId?: string): void {
  const navigate = useNavigate();
  const { data } = useConversations();
  const prevStatus = useRef<Map<string, ConversationStatus>>(new Map());
  const prevElicitations = useRef<Map<string, number>>(new Map());
  // The set of unread session ids backing the badge. A ref (not state) because
  // it drives an imperative OS call, not a render, and must persist across
  // polls without re-triggering the effect.
  const unread = useRef<Set<string>>(new Set());

  useLazyPermissionRequest();

  // Keep `activeConversationId` readable from the focus listener (mounted once)
  // without re-subscribing on every navigation.
  const activeIdRef = useRef<string | undefined>(activeConversationId);
  activeIdRef.current = activeConversationId;

  // Refocusing the window (or having it focused on the open conversation)
  // marks that conversation read. Recompute the badge from the existing set
  // with no new attention ids — `computeUnreadSet` clears the actively-viewed
  // id. No-op in a plain browser (`setBadgeCount` is inert there).
  useEffect(() => {
    const onFocus = () => {
      const next = computeUnreadSet(unread.current, [], activeIdRef.current, true);
      unread.current = next;
      void setBadgeCount(next.size);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const conversations = data?.pages.flatMap((page) => page.data) ?? [];
    if (conversations.length === 0) return;

    const idle = detectIdleTransitions(prevStatus.current, conversations);
    const newElicitations = detectNewElicitations(prevElicitations.current, conversations);
    prevStatus.current = buildStatusMap(conversations);
    prevElicitations.current = buildElicitationMap(conversations);

    const windowFocused = isWindowFocused();
    const grantedOrNative = isNativeShell() || getNotificationPermission() === "granted";

    // A session is "actively viewed" — and thus suppressed — only when the
    // window is focused AND it's the open conversation. De-dupe ids that both
    // finished a turn and raised an elicitation in the same tick.
    const attentionConvs = new Map<string, Conversation>();
    for (const c of [...idle, ...newElicitations]) attentionConvs.set(c.id, c);

    if (grantedOrNative) {
      for (const conversation of idle) {
        if (windowFocused && conversation.id === activeConversationId) continue;
        // Show the agent's final words as the body when we can fetch them;
        // fall back to the generic IDLE_BODY. The fetch is best-effort and
        // async, so we resolve it then fire the toast (a one-item-deep
        // network round-trip, only on a genuine turn-end transition).
        notifyWithPreview(conversation, navigate);
      }
      for (const conversation of newElicitations) {
        if (windowFocused && conversation.id === activeConversationId) continue;
        // Skip a duplicate toast if this id also fired the idle branch above.
        if (idle.some((c) => c.id === conversation.id)) continue;
        notify(conversation, ELICITATION_BODY, navigate);
      }
    }

    // Recompute the unread set from this tick's attention ids and push the
    // badge. Done unconditionally (not gated on permission) so the badge
    // tracks unread state even if web notifications were denied. No-op in a
    // plain browser since `setBadgeCount` is inert outside the desktop shell.
    const next = computeUnreadSet(
      unread.current,
      [...attentionConvs.keys()],
      activeConversationId,
      windowFocused,
    );
    if (!setsEqual(next, unread.current)) {
      unread.current = next;
      void setBadgeCount(next.size);
    }
  }, [data, navigate, activeConversationId]);
}

/** True when two id sets contain exactly the same members. */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Show one notification for a session transition; click opens the chat. */
function notify(
  conversation: Conversation,
  body: string,
  navigate: ReturnType<typeof useNavigate>,
): void {
  showNotification({
    title: conversationDisplayLabel(conversation),
    body,
    // Tag by id so a later update for the same session replaces its
    // toast instead of stacking duplicates.
    tag: `omnigent:session:${conversation.id}`,
    onClick: () => navigate(`/c/${conversation.id}`),
  });
}

/**
 * Notify a turn-end, using the agent's final message text as the body when
 * available. Fetches the session's last assistant text best-effort; on any
 * failure (or a turn that ended without trailing assistant text) it falls
 * back to the generic IDLE_BODY. Fire-and-forget: the toast is shown once the
 * preview resolves, so it never blocks the polling effect.
 */
function notifyWithPreview(
  conversation: Conversation,
  navigate: ReturnType<typeof useNavigate>,
): void {
  void fetchLastAssistantText(conversation.id).then((preview) => {
    notify(conversation, preview ?? IDLE_BODY, navigate);
  });
}
