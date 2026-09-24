import type { BotMcpServer, CapabilityInstall, McpServer } from "@engaz/contracts";
import { Button } from "@engaz/ui-web";
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

type Row = {
  id: string;
  name: string;
  status: string;
  tools?: { allowed: number; offered: number };
};

/** The plugins this agent can use right now, and where to change that. */
export function AgentPlugins({ botId, onManage }: { botId: string; onManage?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.mcp.assignments.list({ botId }),
      rpc.mcp.servers.list(),
      rpc.capabilities.list(),
    ])
      .then(([assignments, servers, sources]) => {
        if (active) setRows(pluginRows(botId, assignments, servers, sources));
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [botId]);

  return (
    <div data-testid="agent-plugins" className="mt-6 border-t border-border/20 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-medium text-foreground">
          <Trans>Plugins</Trans>
        </div>
        {onManage ? (
          <Button type="button" variant="ghost" size="xs" onClick={onManage}>
            <Trans>Manage</Trans>
          </Button>
        ) : null}
      </div>
      {rows && rows.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground/70">
          <Trans>This agent has no plugins yet.</Trans>
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-[13px] text-foreground">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${
                  row.status === "working"
                    ? "bg-success"
                    : row.status === "failing"
                      ? "bg-destructive"
                      : row.status === "sign_in"
                        ? "bg-warning"
                        : "bg-muted-foreground/40"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {row.tools ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  <Plural
                    value={row.tools.offered}
                    one={`${row.tools.allowed} of # tool`}
                    other={`${row.tools.allowed} of # tools`}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function pluginRows(
  botId: string,
  assignments: BotMcpServer[],
  servers: McpServer[],
  sources: CapabilityInstall[],
): Row[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const mcp = assignments.flatMap((assignment): Row[] => {
    const server = byId.get(assignment.serverId);
    if (!server) return [];
    const offered = server.check.tools;
    const allowed = assignment.allowAllTools
      ? offered.length
      : assignment.allowedTools.filter((tool) => offered.includes(tool)).length;
    return [
      {
        id: server.id,
        name: server.name,
        status: server.check.status,
        tools: offered.length > 0 ? { allowed, offered: offered.length } : undefined,
      },
    ];
  });
  const toolSources = sources
    .filter(
      (source) =>
        (source.kind === "mcp" || source.kind === "api" || source.kind === "graphql") &&
        (source.agentIds === null || source.agentIds.includes(botId)),
    )
    .map((source) => ({ id: source.id, name: source.name, status: source.check.status }));
  return [...mcp, ...toolSources];
}
