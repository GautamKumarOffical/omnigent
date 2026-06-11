import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAvailableAgents } from "./useAvailableAgents";

// The hook reads the built-in agent list from GET /v1/agents (a
// PaginatedList envelope) and maps each row into the AvailableAgent
// shape the new-session picker renders. `authenticatedFetch` passes
// through to the global `fetch` when no user id is set (the default
// in jsdom), so stubbing `fetch` exercises the real fetch + mapping
// path rather than a hand-rolled stand-in.
function mockResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  // retry off so the no-network/error case resolves on the first
  // attempt instead of stalling the test on TanStack's backoff.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAvailableAgents", () => {
  it("does not fetch while disabled", async () => {
    const { result } = renderHook(() => useAvailableAgents({ enabled: false }), { wrapper });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches the built-in agent list from /v1/agents", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ object: "list", data: [], has_more: false }),
    );

    const { result } = renderHook(() => useAvailableAgents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Pins the source endpoint. If this drifts back to the retired
    // /api/agents route (or any session-scoped list), the picker would
    // surface conversation-bound agents that aren't launchable as new
    // sessions.
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/v1/agents");
  });

  it("maps rows into AvailableAgent and applies the claude-native, nessie, and debby display names", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        object: "list",
        data: [
          {
            id: "ag_native",
            name: "claude-native-ui",
            description: null,
            harness: "claude-native",
          },
          {
            id: "ag_nessie",
            name: "nessie",
            description: "Multi-agent coding orchestrator.",
            harness: "nessie",
            skills: [{ name: "review-pr", description: "Review a pull request" }],
          },
          {
            id: "ag_debby",
            name: "debby",
            description: "A two-headed brainstorming partner.",
            harness: "claude-sdk",
          },
          {
            id: "ag_yaml",
            name: "databricks_coding_agent",
            description: "A coding agent",
            harness: "codex",
          },
        ],
        has_more: false,
      }),
    );

    const { result } = renderHook(() => useAvailableAgents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // claude-native-ui is the terminal-first wrapper; the picker shows
    // it as "Claude Code". nessie's and debby's lowercase slugs are
    // title-cased to "Nessie" / "Debby". A regression in DISPLAY_NAMES
    // would surface the raw slug to users. Other agents pass their name through as the
    // display name. `harness` is passed through verbatim so the picker
    // can pick a glyph by kind — a custom Codex agent (ag_yaml) keeps
    // its "codex" harness even though its name doesn't say "codex".
    // `skills` passes through verbatim (nessie) and normalises to []
    // when the wire field is absent (older servers) — the landing
    // composer's "/" menu indexes it unconditionally.
    expect(result.current.data).toEqual([
      {
        id: "ag_native",
        name: "claude-native-ui",
        display_name: "Claude Code",
        description: null,
        harness: "claude-native",
        skills: [],
      },
      {
        id: "ag_nessie",
        name: "nessie",
        display_name: "Nessie",
        description: "Multi-agent coding orchestrator.",
        harness: "nessie",
        skills: [{ name: "review-pr", description: "Review a pull request" }],
      },
      {
        id: "ag_debby",
        name: "debby",
        display_name: "Debby",
        description: "A two-headed brainstorming partner.",
        harness: "claude-sdk",
        skills: [],
      },
      {
        id: "ag_yaml",
        name: "databricks_coding_agent",
        display_name: "databricks_coding_agent",
        description: "A coding agent",
        harness: "codex",
        skills: [],
      },
    ]);
  });

  it("defaults a missing harness to null", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        object: "list",
        // `harness` omitted — the server leaves it off when the agent's
        // spec couldn't be loaded. It must normalise to null so the card
        // falls back to the generic glyph instead of leaking undefined.
        data: [{ id: "ag_x", name: "x" }],
        has_more: false,
      }),
    );

    const { result } = renderHook(() => useAvailableAgents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].harness).toBeNull();
  });

  it("defaults a missing description to null", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        object: "list",
        // `description` omitted entirely (not just null) — the picker
        // renders the description conditionally, so undefined must be
        // normalised to null rather than leaking through.
        data: [{ id: "ag_x", name: "x" }],
        has_more: false,
      }),
    );

    const { result } = renderHook(() => useAvailableAgents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].description).toBeNull();
  });

  it("surfaces an error when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "nope" }, { ok: false, status: 500 }),
    );

    const { result } = renderHook(() => useAvailableAgents(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain("500");
  });
});
