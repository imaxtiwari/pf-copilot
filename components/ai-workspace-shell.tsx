"use client";

import { ReactNode, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

type AIWorkspaceShellProps = {
    children: ReactNode;
    panel: ReactNode;
};

export function AIWorkspaceShell({ children, panel }: AIWorkspaceShellProps) {
    const [panelOpen, setPanelOpen] = useState(true);

    return (
        <div className="relative flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden p-4 md:flex-row">
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                {children}
            </main>

            {/* Desktop side panel */}
            <aside
                className={`hidden h-full shrink-0 transition-all duration-300 md:block ${panelOpen ? "w-96 opacity-100" : "w-0 overflow-hidden opacity-0"
                    }`}
            >
                {panel}
            </aside>

            {/* Desktop toggle */}
            <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                className="absolute right-4 top-4 hidden rounded-md border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 md:block"
                aria-label={panelOpen ? "Hide AI workspace" : "Show AI workspace"}
            >
                {panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>

            {/* Mobile bottom sheet */}
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] md:hidden" data-testid="mobile-bottom-sheet">
                <div className="rounded-t-xl border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)] dark:border-slate-700 dark:bg-slate-900">
                    {panel}
                </div>
            </div>
        </div>
    );
}
