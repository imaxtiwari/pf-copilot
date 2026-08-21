"use client";

import type { AgentName } from "@/lib/contracts/agent-events";

const AGENT_META: Record<
    AgentName,
    { initials: string; title: string; bg: string; text: string }
> = {
    "Portfolio Analyst": {
        initials: "PA",
        title: "Portfolio Analyst",
        bg: "bg-blue-100 dark:bg-blue-900",
        text: "text-blue-700 dark:text-blue-200",
    },
    "Inflation Analyst": {
        initials: "IA",
        title: "Inflation Analyst",
        bg: "bg-amber-100 dark:bg-amber-900",
        text: "text-amber-700 dark:text-amber-200",
    },
    "Performance Analyst": {
        initials: "PF",
        title: "Performance Analyst",
        bg: "bg-emerald-100 dark:bg-emerald-900",
        text: "text-emerald-700 dark:text-emerald-200",
    },
    "Fund Research Agent": {
        initials: "FR",
        title: "Fund Research Agent",
        bg: "bg-purple-100 dark:bg-purple-900",
        text: "text-purple-700 dark:text-purple-200",
    },
    "Risk Analyst": {
        initials: "RA",
        title: "Risk Analyst",
        bg: "bg-rose-100 dark:bg-rose-900",
        text: "text-rose-700 dark:text-rose-200",
    },
    Copilot: {
        initials: "CP",
        title: "Copilot",
        bg: "bg-slate-100 dark:bg-slate-800",
        text: "text-slate-700 dark:text-slate-200",
    },
};

type AgentAvatarProps = {
    name: AgentName;
    size?: "sm" | "md" | "lg";
};

const SIZE_CLASSES = {
    sm: "w-7 h-7 text-[10px]",
    md: "w-9 h-9 text-xs",
    lg: "w-11 h-11 text-sm",
};

export function AgentAvatar({ name, size = "md" }: AgentAvatarProps) {
    const meta = AGENT_META[name];
    return (
        <div
            className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${meta.bg} ${meta.text} ${SIZE_CLASSES[size]}`}
            title={meta.title}
            aria-label={meta.title}
        >
            {meta.initials}
        </div>
    );
}
