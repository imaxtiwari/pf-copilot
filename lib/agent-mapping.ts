import type { ToolTrace } from "@/lib/orchestrator";
import {
    type AgentName,
    type AgentState,
    type AgentStatus,
    type ActivityItem,
    type CopilotStatus,
    type Evidence,
    type WorkspaceState,
} from "@/lib/contracts/agent-events";

const ALL_AGENTS: AgentName[] = [
    "Portfolio Analyst",
    "Inflation Analyst",
    "Performance Analyst",
    "Fund Research Agent",
    "Risk Analyst",
    "Copilot",
];

const TOOL_TO_AGENT: Record<string, AgentName> = {
    get_portfolio: "Portfolio Analyst",
    compute_personal_inflation: "Inflation Analyst",
    compute_real_returns: "Performance Analyst",
    lookup_chat_history: "Copilot",
    explain_fund: "Fund Research Agent",
    compare_funds: "Fund Research Agent",
    explain_stock: "Risk Analyst",
};

const AGENT_TASKS: Record<AgentName, { working: string; complete: string; next: string }> = {
    "Portfolio Analyst": {
        working: "Loading and classifying your portfolio holdings",
        complete: "Portfolio holdings mapped",
        next: "Hand over to Performance Analyst for return analysis",
    },
    "Inflation Analyst": {
        working: "Computing your personal inflation rate from profile",
        complete: "Personal inflation rate ready",
        next: "Share rate with Performance Analyst",
    },
    "Performance Analyst": {
        working: "Calculating real and nominal returns",
        complete: "Real-return analysis complete",
        next: "Summarise findings for Copilot",
    },
    "Fund Research Agent": {
        working: "Retrieving AMFI factsheet data",
        complete: "Factsheet findings ready",
        next: "Cite sources and return to Copilot",
    },
    "Risk Analyst": {
        working: "Analysing stock-level disclosures and risk signals",
        complete: "Risk review complete",
        next: "Return risk summary to Copilot",
    },
    Copilot: {
        working: "Understanding your question and routing to analysts",
        complete: "Synthesis complete",
        next: "Deliver final answer",
    },
};

export function mapToolNameToAgentName(toolName: string): AgentName {
    return TOOL_TO_AGENT[toolName] ?? "Copilot";
}

export function getAllAgentNames(): readonly AgentName[] {
    return ALL_AGENTS;
}

export function mapToolTraceToAgentStates(toolTraces: ToolTrace[]): AgentState[] {
    const seenAgents = new Set<AgentName>();
    const agentTraces = new Map<AgentName, ToolTrace[]>();

    for (const trace of toolTraces) {
        const agent = mapToolNameToAgentName(trace.tool);
        seenAgents.add(agent);
        const list = agentTraces.get(agent) ?? [];
        list.push(trace);
        agentTraces.set(agent, list);
    }

    const orderedAgents: AgentName[] = [];
    for (const trace of toolTraces) {
        const agent = mapToolNameToAgentName(trace.tool);
        if (!orderedAgents.includes(agent)) orderedAgents.push(agent);
    }

    return ALL_AGENTS.map((agent) => {
        const traces = agentTraces.get(agent);
        const status = deriveAgentStatus(agent, traces, orderedAgents);
        const evidence = traces ? extractEvidence(agent, traces) : [];
        const currentTask = deriveCurrentTask(agent, status, traces);
        const nextStep = deriveNextStep(agent, status);

        return {
            name: agent,
            status,
            currentTask,
            evidence,
            nextStep,
            progress: status === "working" ? 50 : status === "complete" ? 100 : undefined,
        };
    });
}

function deriveAgentStatus(
    agent: AgentName,
    traces: ToolTrace[] | undefined,
    orderedAgents: AgentName[],
): AgentStatus {
    if (!traces || traces.length === 0) {
        return "idle";
    }

    const hasError = traces.some(
        (t) =>
            t.result &&
            typeof t.result === "object" &&
            "error" in t.result &&
            t.result.error !== undefined &&
            t.result.error !== null,
    );

    const allComplete = traces.every(
        (t) => t.result !== undefined && t.result !== null,
    );

    if (!allComplete || hasError) {
        const agentIdx = orderedAgents.indexOf(agent);
        const lastStartedIdx = orderedAgents.length - 1;
        // If this agent is not the most recently started one, it is waiting
        // for the current working agent to finish.
        return agentIdx === lastStartedIdx ? "working" : "waiting";
    }

    return "complete";
}

function deriveCurrentTask(agent: AgentName, status: AgentStatus, traces?: ToolTrace[]): string {
    const tasks = AGENT_TASKS[agent];
    if (status === "complete") return tasks.complete;
    if (status === "working" || status === "waiting") return tasks.working;
    if (status === "queued") return "Queued behind other analysts";
    if (traces && traces.length > 0 && traces[traces.length - 1]) {
        return `Finished ${traces[traces.length - 1].tool}`;
    }
    return "Standing by";
}

function deriveNextStep(agent: AgentName, status: AgentStatus): string {
    const tasks = AGENT_TASKS[agent];
    if (status === "complete") return tasks.next;
    if (status === "working") return tasks.next;
    if (status === "waiting") return "Waiting for predecessor analyst to finish";
    return "Will activate if needed";
}

function extractEvidence(agent: AgentName, traces: ToolTrace[]): Evidence[] {
    const evidence: Evidence[] = [];

    for (const trace of traces) {
        const result = trace.result;
        if (!result || typeof result !== "object") continue;
        const r = result as Record<string, unknown>;

        switch (agent) {
            case "Portfolio Analyst": {
                if (Array.isArray(r.holdings)) {
                    evidence.push({ label: "Holdings", value: String(r.holdings.length) });
                    const top = r.holdings.slice(0, 3) as Array<{ scheme_name?: string; market_value?: number }>;
                    for (const h of top) {
                        if (h.scheme_name) {
                            evidence.push({
                                label: "Holding",
                                value: `${h.scheme_name}${h.market_value ? ` · ₹${formatCompact(h.market_value)}` : ""}`,
                            });
                        }
                    }
                }
                if (typeof r.total_value === "number") {
                    evidence.push({ label: "Total value", value: `₹${formatCompact(r.total_value)}` });
                }
                if (r.truncated && typeof r.truncated === "object") {
                    const t = r.truncated as { count?: number };
                    if (t.count) evidence.push({ label: "Truncated tail", value: String(t.count) });
                }
                break;
            }
            case "Inflation Analyst": {
                if (typeof r.inflation_rate === "number") {
                    evidence.push({ label: "Personal inflation", value: `${r.inflation_rate}%` });
                }
                if (r.confidence) {
                    evidence.push({ label: "Confidence", value: String(r.confidence) });
                }
                if (Array.isArray(r.breakdown) && r.breakdown.length > 0) {
                    const first = r.breakdown[0] as { sleeve?: string; contribution?: number };
                    evidence.push({
                        label: "Largest bucket",
                        value: `${first.sleeve ?? "unknown"} · ${first.contribution ?? 0}%`,
                    });
                }
                break;
            }
            case "Performance Analyst": {
                if (typeof r.personal_inflation_rate === "number") {
                    evidence.push({
                        label: "Inflation applied",
                        value: `${r.personal_inflation_rate}%`,
                    });
                }
                if (r.your_holding && typeof r.your_holding === "object") {
                    const h = r.your_holding as { market_value?: number; as_of_date?: string };
                    evidence.push({
                        label: "Holding value",
                        value: `₹${formatCompact(h.market_value ?? 0)}${h.as_of_date ? ` · ${h.as_of_date}` : ""}`,
                    });
                }
                if (typeof r.coverage_ratio === "number") {
                    evidence.push({ label: "Coverage", value: `${Math.round(r.coverage_ratio * 100)}%` });
                }
                break;
            }
            case "Fund Research Agent": {
                if (typeof r.scheme_name === "string") {
                    evidence.push({ label: "Scheme", value: r.scheme_name });
                }
                if (typeof r.scheme_code === "string") {
                    evidence.push({ label: "AMFI code", value: r.scheme_code });
                }
                if (Array.isArray(r.citations) && r.citations.length > 0) {
                    evidence.push({ label: "Cited sources", value: String(r.citations.length) });
                }
                if (r.refused === true && typeof r.refusal_reason === "string") {
                    evidence.push({ label: "Refusal", value: r.refusal_reason });
                }
                break;
            }
            case "Risk Analyst": {
                if (typeof r.isin === "string") {
                    evidence.push({ label: "ISIN", value: r.isin });
                }
                if (typeof r.company_name === "string") {
                    evidence.push({ label: "Company", value: r.company_name });
                }
                if (Array.isArray(r.citations) && r.citations.length > 0) {
                    evidence.push({ label: "Cited sources", value: String(r.citations.length) });
                }
                if (r.refused === true && typeof r.refusal_reason === "string") {
                    evidence.push({ label: "Refusal", value: r.refusal_reason });
                }
                break;
            }
            case "Copilot": {
                if (Array.isArray(r.messages)) {
                    evidence.push({ label: "Turns recalled", value: String(r.messages.length) });
                }
                break;
            }
        }
    }

    return evidence;
}

export function deriveCopilotStatus(
    agentStates: AgentState[],
    isComplete: boolean,
): CopilotStatus {
    if (isComplete) return "complete";

    const working = agentStates.filter((a) => a.status === "working").map((a) => a.name);
    const waiting = agentStates.filter((a) => a.status === "waiting").map((a) => a.name);
    const complete = agentStates.filter((a) => a.status === "complete").map((a) => a.name);

    if (waiting.length > 0 && complete.length > 0) {
        return "cross-checking";
    }
    if (working.some((n) => n === "Fund Research Agent" || n === "Risk Analyst")) {
        return "researching";
    }
    if (working.some((n) => n === "Performance Analyst" || n === "Inflation Analyst")) {
        return "analysing";
    }
    if (complete.length > 0) {
        return "synthesizing";
    }
    return "analysing";
}

export function buildActivityFeed(
    agentStates: AgentState[],
    assistantMessage?: string,
): ActivityItem[] {
    const items: ActivityItem[] = [];
    const now = new Date();

    for (const agent of agentStates) {
        if (agent.status === "idle") continue;
        items.push({
            id: `${agent.name}-start`,
            timestamp: now,
            agent: agent.name,
            message:
                agent.status === "complete"
                    ? `${agent.name} completed: ${agent.currentTask.toLowerCase()}`
                    : `${agent.name} ${agent.status}: ${agent.currentTask.toLowerCase()}`,
            evidence: agent.evidence,
        });
    }

    if (assistantMessage) {
        items.push({
            id: "copilot-final",
            timestamp: now,
            agent: "Copilot",
            message: "Copilot synthesised the final response",
            evidence: [{ label: "Response length", value: `${assistantMessage.length} chars` }],
        });
    }

    return items;
}

export function formatWorkspaceSummary(agentStates: AgentState[]): string {
    const counts = {
        working: 0,
        complete: 0,
        queued: 0,
        waiting: 0,
        idle: 0,
    };
    for (const a of agentStates) {
        counts[a.status] = (counts[a.status] ?? 0) + 1;
    }

    const parts: string[] = [];
    if (counts.working > 0) parts.push(`${counts.working} working`);
    if (counts.complete > 0) parts.push(`${counts.complete} complete`);
    if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
    if (counts.queued > 0) parts.push(`${counts.queued} queued`);

    const summary = parts.length > 0 ? parts.join(" · ") : "0 working · 0 complete";
    const prefix = counts.working > 0 ? "Your financial team is working" : "Your financial team";
    return `${prefix} · ${summary}`;
}

export function buildWorkspaceState(
    toolTraces: ToolTrace[],
    assistantMessage?: string,
    isComplete = false,
): WorkspaceState {
    const agents = mapToolTraceToAgentStates(toolTraces);
    const copilotStatus = deriveCopilotStatus(agents, isComplete);
    const activity = buildActivityFeed(agents, assistantMessage);
    const summary = formatWorkspaceSummary(agents);
    return { copilotStatus, agents, activity, summary };
}

function formatCompact(n: number): string {
    if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
    if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(Math.round(n));
}
