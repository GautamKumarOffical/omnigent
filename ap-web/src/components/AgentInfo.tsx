// Agent info surface: the MCP-server and policy badges plus the
// header info-icon popover that displays them.

import { useState } from "react";
import { InfoIcon, PlusIcon, ServerIcon, ShieldCheckIcon, TrashIcon } from "lucide-react";
import type { Agent, McpServerSummary } from "@/hooks/useAgents";
import {
  usePolicies,
  usePolicyRegistry,
  useAddPolicy,
  useDeletePolicy,
  type PolicyRegistryEntry,
} from "@/hooks/usePolicies";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chatStore";

/** Trigger-pill display aliases for native agents. */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-native-ui": "claude",
  "codex-native-ui": "codex",
};

/** Compact pill row listing MCP servers attached to an agent. */
export function McpServerList({ servers }: { servers: McpServerSummary[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {servers.map((srv) => (
        <span
          key={srv.name}
          title={srv.description ?? srv.name}
          className="flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          <ServerIcon className="size-2.5 shrink-0" />
          {srv.name}
        </span>
      ))}
    </div>
  );
}

/** Small uppercase section label inside the agent-info popover. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </span>
  );
}

/** Format cumulative session spend: `$x.xx`, or `<$0.01` for sub-cent. */
function formatSessionCostUsd(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) {
    // Genuinely priced but rounds to $0.00 — distinguish from free.
    return "<$0.01";
  }
  return `$${costUsd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Add-policy dialog
// ---------------------------------------------------------------------------

function AddPolicyDialog({
  sessionId,
  registry,
  appliedHandlers,
  open,
  onOpenChange,
}: {
  sessionId: string;
  registry: PolicyRegistryEntry[];
  appliedHandlers: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [factoryParams, setFactoryParams] = useState<Record<string, string>>(
    {},
  );
  const addPolicy = useAddPolicy(sessionId);

  const entry = registry.find((r) => r.handler === selected);
  const schema = entry?.params_schema as
    | {
        properties?: Record<
          string,
          {
            type?: string;
            description?: string;
            default?: unknown;
            enum?: string[];
            items?: { type?: string; enum?: string[] };
            uniqueItems?: boolean;
          }
        >;
        required?: string[];
      }
    | null
    | undefined;
  const properties = schema?.properties ?? {};
  const paramKeys = Object.keys(properties);

  function handleSelect(handler: string) {
    setSelected(handler);
    setFilter("");
    setFactoryParams({});
  }

  function handleAdd() {
    if (!entry) return;
    let parsedParams: Record<string, unknown> | undefined;
    if (entry.kind === "factory" && paramKeys.length > 0) {
      parsedParams = {};
      for (const key of paramKeys) {
        const raw = factoryParams[key];
        const prop = properties[key];
        if (raw !== undefined && raw !== "") {
          if (prop?.type === "integer") parsedParams[key] = parseInt(raw, 10);
          else if (prop?.type === "number") parsedParams[key] = parseFloat(raw);
          else if (prop?.type === "boolean") parsedParams[key] = raw === "true";
          else if (prop?.type === "array")
            parsedParams[key] = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          else parsedParams[key] = raw;
        }
      }
    }
    // Always send factory_params for factory-kind policies (even
    // if empty) so the stored entity has ``factory_params={}``
    // instead of ``None``. The builder uses ``arguments is not
    // None`` to distinguish factory form (invoke with kwargs)
    // from direct-callable form (use as-is). Without this,
    // factories like ``deny_pii_in_llm_request`` are called as
    // ``factory(event)`` instead of ``factory()(event)``.
    const includeFactoryParams =
      entry.kind === "factory"
        ? { factory_params: parsedParams ?? {} }
        : {};
    addPolicy.mutate(
      {
        name: entry.name.toLowerCase().replace(/\s+/g, "_"),
        type: "python",
        handler: entry.handler,
        ...includeFactoryParams,
      },
      {
        onSuccess: () => {
          setSelected("");
          setFactoryParams({});
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Policy</DialogTitle>
          <DialogDescription>
            Choose a policy to apply to this session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {!selected && (() => {
            const available = registry.filter((r) => !appliedHandlers.has(r.handler));
            const lowerFilter = filter.toLowerCase();
            const filtered = lowerFilter
              ? available.filter(
                  (r) =>
                    r.name.toLowerCase().includes(lowerFilter) ||
                    r.description?.toLowerCase().includes(lowerFilter),
                )
              : available;
            return (
              <>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter policies..."
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <div className="flex max-h-52 flex-col divide-y divide-border overflow-y-auto rounded border border-border">
                  {filtered.map((r) => (
                    <button
                      key={r.handler}
                      type="button"
                      onClick={() => handleSelect(r.handler)}
                      className="flex flex-col gap-0.5 px-2.5 py-2 text-left hover:bg-muted"
                    >
                      <span className="text-sm">{r.name}</span>
                      {r.description && (
                        <span className="line-clamp-2 text-[11px] text-muted-foreground">
                          {r.description}
                        </span>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {available.length === 0
                        ? "All available policies are already applied."
                        : "No policies match your filter."}
                    </p>
                  )}
                </div>
              </>
            );
          })()}
          {entry && (
            <div className="flex flex-col gap-1 rounded border border-border bg-muted/50 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{entry.name}</span>
                <button
                  type="button"
                  onClick={() => { setSelected(""); setFactoryParams({}); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Change
                </button>
              </div>
              {entry.description && (
                <p className="text-xs text-muted-foreground">
                  {entry.description}
                </p>
              )}
            </div>
          )}
          {entry?.kind === "factory" && paramKeys.length > 0 && (
            <div className="space-y-2">
              {paramKeys.map((key) => {
                const prop = properties[key];
                return (
                  <div key={key}>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{key}</span>
                      {prop?.type && (
                        <span>
                          (
                          {prop.type === "array" && prop.items?.enum
                            ? "select"
                            : prop.type === "array"
                              ? "comma-separated"
                              : prop.type}
                          )
                        </span>
                      )}
                    </label>
                    {prop?.description && (
                      <p className="text-[11px] text-muted-foreground">
                        {prop.description}
                      </p>
                    )}
                    {prop?.type === "boolean" ? (
                      <select
                        value={
                          factoryParams[key] ??
                          (prop?.default !== undefined
                            ? String(prop.default)
                            : "")
                        }
                        onChange={(e) =>
                          setFactoryParams((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : prop?.type === "string" && prop.enum ? (
                      <select
                        value={
                          factoryParams[key] ??
                          (prop?.default !== undefined
                            ? String(prop.default)
                            : prop.enum[0] ?? "")
                        }
                        onChange={(e) =>
                          setFactoryParams((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        {prop.enum.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : prop?.type === "array" && prop.items?.enum ? (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                        {prop.items.enum.map((v) => {
                          const current = factoryParams[key]
                            ? factoryParams[key].split(",").filter(Boolean)
                            : (Array.isArray(prop?.default)
                                ? (prop.default as string[])
                                : []);
                          const checked = current.includes(v);
                          return (
                            <label
                              key={v}
                              className="flex items-center gap-1 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...current, v]
                                    : current.filter((x) => x !== v);
                                  setFactoryParams((prev) => ({
                                    ...prev,
                                    [key]: next.join(","),
                                  }));
                                }}
                                className="rounded border-border"
                              />
                              <span>{v}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        type={
                          prop?.type === "integer" || prop?.type === "number"
                            ? "number"
                            : "text"
                        }
                        placeholder={
                          prop?.type === "array"
                            ? (prop?.default !== undefined
                                ? (prop.default as string[]).join(", ")
                                : "comma-separated values")
                            : prop?.default !== undefined
                              ? String(prop.default)
                              : ""
                        }
                        value={factoryParams[key] ?? ""}
                        onChange={(e) =>
                          setFactoryParams((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-3 py-1.5 text-xs hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!selected || addPolicy.isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              {addPolicy.isPending ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Session policies section (user-editable only)
// ---------------------------------------------------------------------------

function SessionPoliciesSection({ sessionId }: { sessionId: string }) {
  const { data: sessionPolicies = [] } = usePolicies(sessionId);
  const { data: registry = [] } = usePolicyRegistry();
  const deletePolicy = useDeletePolicy(sessionId);
  const [addOpen, setAddOpen] = useState(false);

  const userPolicies = sessionPolicies.filter((p) => p.source === "session");
  const registryByHandler = new Map(registry.map((r) => [r.handler, r]));
  const appliedHandlers = new Set(
    sessionPolicies
      .map((p) => p.handler)
      .filter((h): h is string => h != null),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Policies</SectionLabel>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded p-0.5 hover:bg-muted"
          title="Add policy"
        >
          <PlusIcon className="size-3 text-muted-foreground" />
        </button>
      </div>
      {userPolicies.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {userPolicies.map((p) => {
            const description =
              p.description ??
              (p.handler
                ? registryByHandler.get(p.handler)?.description
                : undefined);
            return (
              <Popover key={p.id ?? p.name}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/80"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ShieldCheckIcon className="size-2.5 shrink-0" />
                    {p.name}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="w-64"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
                      <span className="font-medium text-sm">{p.name}</span>
                    </div>
                    {description && (
                      <p className="text-xs text-muted-foreground">
                        {description}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => p.id && deletePolicy.mutate(p.id)}
                      className="flex items-center gap-1 self-end rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <TrashIcon className="size-3" />
                      Remove
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No policies added</p>
      )}
      <AddPolicyDialog
        sessionId={sessionId}
        registry={registry}
        appliedHandlers={appliedHandlers}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface AgentInfoProps {
  /** The bound agent for the active session. Undefined while loading. */
  agent: Agent | undefined;
  /** Session ID — needed to manage user policies. */
  sessionId?: string | null;
}

/**
 * Whether an agent has any tools worth surfacing in the info popover.
 * Always true when a sessionId is provided (policies section is always shown).
 */
export function agentHasInfo(agent: Agent | undefined, sessionId?: string | null): boolean {
  return !!sessionId || (agent?.mcp_servers?.length ?? 0) > 0;
}

/**
 * The agent's tools & policies body, sans trigger.
 *
 * Shared by the desktop header popover ({@link AgentInfoButton}) and the
 * mobile header menu's agent-info dialog.
 */
export function AgentInfoContent({ agent, sessionId }: AgentInfoProps) {
  const servers = agent?.mcp_servers ?? [];
  const displayName = agent ? (AGENT_DISPLAY_NAMES[agent.name] ?? agent.name) : null;
  // Cumulative session spend, live from the store (seeded on bind, updated
  // by SSE ``session_usage``). ``null`` when the session is unpriced (no
  // turn priced yet) — omit the row rather than show "$0.00" / "—".
  const sessionCostUsd = useChatStore((s) => s.sessionCostUsd);

  return (
    <div className="flex flex-col gap-3">
      {displayName && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{displayName}</span>
          {agent?.description && (
            <span className="text-xs text-muted-foreground">{agent.description}</span>
          )}
        </div>
      )}
      {sessionId && sessionCostUsd != null && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Session cost</SectionLabel>
          <span
            className="text-sm tabular-nums text-muted-foreground"
            data-testid="agent-info-session-cost"
          >
            {formatSessionCostUsd(sessionCostUsd)}
          </span>
        </div>
      )}
      {servers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Tools</SectionLabel>
          <McpServerList servers={servers} />
        </div>
      )}
      {sessionId && <SessionPoliciesSection sessionId={sessionId} />}
    </div>
  );
}

/**
 * Header info icon revealing the active agent's tools & policies.
 *
 * Desktop-only: on mobile (`< md`) the same content is reached via the
 * header's three-dot menu, which opens {@link AgentInfoContent} in a
 * dialog. Self-hides when the agent has neither tools nor policies.
 */
export function AgentInfoButton({ agent, sessionId }: AgentInfoProps) {
  if (!agentHasInfo(agent, sessionId)) return null;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Agent tools and policies"
              data-testid="agent-info-trigger"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <InfoIcon className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Agent tools &amp; policies</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <AgentInfoContent agent={agent} sessionId={sessionId} />
      </PopoverContent>
    </Popover>
  );
}
