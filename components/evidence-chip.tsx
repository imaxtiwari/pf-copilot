"use client";

import type { Evidence } from "@/lib/contracts/agent-events";

type EvidenceChipProps = {
    evidence: Evidence;
};

export function EvidenceChip({ evidence }: EvidenceChipProps) {
    const content = (
        <span className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span className="font-medium">{evidence.label}:</span>
            <span className="truncate" title={evidence.value}>
                {evidence.value}
            </span>
        </span>
    );

    if (evidence.href) {
        return (
            <a
                href={evidence.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block hover:opacity-80"
                title={`${evidence.label}: ${evidence.value}`}
            >
                {content}
            </a>
        );
    }

    return (
        <span
            className="inline-block"
            title={`${evidence.label}: ${evidence.value}`}
        >
            {content}
        </span>
    );
}
