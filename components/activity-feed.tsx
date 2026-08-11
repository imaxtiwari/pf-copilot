"use client";

import { useEffect, useRef } from "react";
import type { ActivityItem } from "@/lib/contracts/agent-events";
import { AgentAvatar } from "@/components/agent-avatar";
import { EvidenceChip } from "@/components/evidence-chip";

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type ActivityFeedProps = {
    items: ActivityItem[];
};

export function ActivityFeed({ items }: ActivityFeedProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [items]);

    if (items.length === 0) {
        return (
            <div className="rounded-md border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No activity yet.
            </div>
        );
    }

    return (
        <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
            <ul className="space-y-3" aria-live="polite" aria-label="Agent activity feed">
                {items.map((item) => (
                    <li key={item.id} className="flex gap-2">
                        <AgentAvatar name={item.agent} size="sm" />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-medium text-slate-700 dark:text-slate-200">{item.agent}</span>
                                <span>·</span>
                                <time dateTime={item.timestamp.toISOString()}>{formatTime(item.timestamp)}</time>
                            </div>
                            <p className="text-sm text-slate-800 dark:text-slate-100">{item.message}</p>
                            {item.evidence && item.evidence.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {item.evidence.map((e, i) => (
                                        <EvidenceChip key={`${e.label}-${i}`} evidence={e} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <div ref={bottomRef} />
        </div>
    );
}
