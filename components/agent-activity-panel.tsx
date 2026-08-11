"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import type { WorkspaceState } from "@/lib/contracts/agent-events";
import { AgentCard } from "@/components/agent-card";
import { ActivityFeed } from "@/components/activity-feed";
import { CopilotStatusPill } from "@/components/copilot-status";

type AgentActivityPanelProps = {
    state: WorkspaceState;
    expanded?: boolean;
    onToggleExpand?: () => void;
};

export function AgentActivityPanel({
    state,
    expanded = true,
    onToggleExpand,
}: AgentActivityPanelProps) {
    const workingAgents = state.agents
        .filter((a) => a.status === "working")
        .slice(0, 3);

    return (
        <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
                <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        AI Workspace
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {state.summary}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <CopilotStatusPill status={state.copilotStatus} />
                    {onToggleExpand && (
                        <button
                            type="button"
                            onClick={onToggleExpand}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
                            aria-label={expanded ? "Collapse panel" : "Expand panel"}
                        >
                            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {!expanded && workingAgents.length > 0 && (
                    <div className="text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-medium">Working now:</span>{" "}
                        {workingAgents.map((a) => a.name).join(", ")}
                    </div>
                )}

                {state.agents.map((agent) => (
                    <AgentCard
                        key={agent.name}
                        agent={agent}
                        defaultExpanded={expanded && agent.status === "working"}
                    />
                ))}

                {expanded && (
                    <div className="pt-2" data-testid="activity-section">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Activity
                        </h3>
                        <ActivityFeed items={state.activity} />
                    </div>
                )}
            </div>
        </div>
    );
}
