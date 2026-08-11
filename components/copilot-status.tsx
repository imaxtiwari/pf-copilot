"use client";

import type { CopilotStatus } from "@/lib/contracts/agent-events";

const STATUS_CONFIG: Record<
    CopilotStatus,
    { label: string; dotClass: string }
> = {
    analysing: { label: "Analysing", dotClass: "bg-blue-500 animate-pulse" },
    researching: { label: "Researching", dotClass: "bg-purple-500 animate-pulse" },
    "cross-checking": {
        label: "Cross-checking",
        dotClass: "bg-amber-500 animate-pulse",
    },
    synthesizing: {
        label: "Synthesizing",
        dotClass: "bg-emerald-500 animate-pulse",
    },
    complete: { label: "Complete", dotClass: "bg-emerald-600" },
};

type CopilotStatusProps = {
    status: CopilotStatus;
};

export function CopilotStatusPill({ status }: CopilotStatusProps) {
    const config = STATUS_CONFIG[status];
    return (
        <div
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            aria-live="polite"
            aria-label={`Copilot status: ${config.label}`}
        >
            <span
                className={`h-2 w-2 rounded-full ${config.dotClass}`}
                aria-hidden="true"
            />
            {config.label}
        </div>
    );
}
