"use client";

import type { CopilotStatus } from "@/lib/contracts/agent-events";

import { Loader2, CheckCircle2, Search, ShieldCheck, Sparkles } from "lucide-react";

const STATUS_CONFIG: Record<
    CopilotStatus,
    { label: string; dotClass: string; icon: React.ReactNode }
> = {
    analysing: { label: "Analysing", dotClass: "bg-blue-500", icon: <Loader2 size={14} className="animate-spin" aria-hidden="true" /> },
    researching: { label: "Researching", dotClass: "bg-purple-500", icon: <Search size={14} aria-hidden="true" /> },
    "cross-checking": {
        label: "Cross-checking",
        dotClass: "bg-amber-500",
        icon: <ShieldCheck size={14} aria-hidden="true" />,
    },
    synthesizing: {
        label: "Synthesizing",
        dotClass: "bg-emerald-500",
        icon: <Sparkles size={14} aria-hidden="true" />,
    },
    complete: { label: "Complete", dotClass: "bg-emerald-600", icon: <CheckCircle2 size={14} aria-hidden="true" /> },
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
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${config.dotClass} text-white`}
                aria-hidden="true"
            >
                {config.icon}
            </span>
            {config.label}
        </div>
    );
}
