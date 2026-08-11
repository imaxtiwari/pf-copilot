"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentState } from "@/lib/contracts/agent-events";
import { AgentAvatar } from "@/components/agent-avatar";
import { EvidenceChip } from "@/components/evidence-chip";

const STATUS_STYLES: Record<
    AgentState["status"],
    { label: string; badge: string }
> = {
    working: {
        label: "Working",
        badge:
            "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
    },
    complete: {
        label: "Complete",
        badge:
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200",
    },
    queued: {
        label: "Queued",
        badge:
            "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    },
    waiting: {
        label: "Waiting",
        badge:
            "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
    },
    idle: {
        label: "Idle",
        badge:
            "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    },
};

type AgentCardProps = {
    agent: AgentState;
    defaultExpanded?: boolean;
};

export function AgentCard({ agent, defaultExpanded = false }: AgentCardProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const statusStyle = STATUS_STYLES[agent.status];

    return (
        <div
            className={`rounded-lg border bg-white p-3 shadow-sm transition dark:border-slate-700 dark:bg-slate-900 ${agent.status === "working"
                ? "border-blue-200 ring-1 ring-blue-100 dark:border-blue-800 dark:ring-blue-900"
                : "border-slate-200"
                }`}
        >
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex w-full items-center gap-3 text-left"
                aria-expanded={expanded}
                aria-label={`${agent.name} card, ${statusStyle.label}`}
                data-agent-card={agent.name}
            >
                <AgentAvatar name={agent.name} size="sm" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {agent.name}
                        </span>
                        <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle.badge}`}
                        >
                            {statusStyle.label}
                        </span>
                    </div>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {agent.currentTask}
                    </p>
                    {typeof agent.progress === "number" && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                                style={{ width: `${agent.progress}%` }}
                            />
                        </div>
                    )}
                </div>
                <span className="shrink-0 text-slate-400">
                    {expanded ? (
                        <ChevronDown size={16} aria-hidden="true" />
                    ) : (
                        <ChevronRight size={16} aria-hidden="true" />
                    )}
                </span>
            </button>

            <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
            >
                <div className="overflow-hidden">
                    <div className="pt-3">
                        {agent.evidence.length > 0 && (
                            <div data-testid="agent-evidence" className="mb-3 flex flex-wrap gap-1.5">
                                {agent.evidence.map((e, i) => (
                                    <EvidenceChip key={`${e.label}-${i}`} evidence={e} />
                                ))}
                            </div>
                        )}
                        <div data-testid="agent-next-step" className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <span className="font-semibold">Next:</span> {agent.nextStep}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
