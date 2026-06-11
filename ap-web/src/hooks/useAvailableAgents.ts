import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/identity";

export interface AvailableAgent {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  // Harness/kind from GET /v1/agents, e.g. "codex", "codex-native",
  // "claude-native", or "claude-sdk". null when the server couldn't load
  // the agent's spec. Lets the picker recognise Codex vs Claude agents
  // by kind rather than by name slug.
  harness: string | null;
  // Skills bundled in the agent spec (name + one-line description).
  // Feeds the landing composer's "/" menu before a session exists;
  // host-discovered skills only resolve once a runner is bound, so
  // they're absent here. Empty on older servers without the field.
  skills: { name: string; description: string }[];
}

const DISPLAY_NAMES: Record<string, string> = {
  "claude-native-ui": "Claude Code",
  "codex-native-ui": "Codex",
  // nessie is no longer seeded, but older deployments retain their row.
  nessie: "Nessie",
  polly: "Polly",
  debby: "Debby",
};

// The new-session picker lists built-in agents only and binds them by
// agent_id. Source is the read-only built-in list GET /v1/agents (see
// designs/BUILTIN_AGENTS.md). Session-scoped agents are tied to one
// conversation and aren't launchable as new sessions, so they're not
// listed here — this is also why the picker no longer touches the old
// /api/agents endpoints.
async function fetchAvailableAgents(): Promise<AvailableAgent[]> {
  const res = await authenticatedFetch("/v1/agents");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as {
    data: Array<{
      id: string;
      name: string;
      description?: string | null;
      harness?: string | null;
      skills?: { name: string; description: string }[];
    }>;
  };
  return body.data.map((a) => ({
    id: a.id,
    name: a.name,
    display_name: DISPLAY_NAMES[a.name] ?? a.name,
    description: a.description ?? null,
    harness: a.harness ?? null,
    skills: a.skills ?? [],
  }));
}

interface UseAvailableAgentsOptions {
  enabled?: boolean;
}

export function useAvailableAgents(options: UseAvailableAgentsOptions = {}) {
  return useQuery({
    queryKey: ["available-agents"],
    queryFn: fetchAvailableAgents,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}
