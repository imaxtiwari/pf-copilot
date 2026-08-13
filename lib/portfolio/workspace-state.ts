import {
    deriveCopilotStatus,
    formatWorkspaceSummary,
} from "@/lib/agent-mapping";
import type {
    AgentName,
    AgentState,
    ActivityItem,
    WorkspaceState,
} from "@/lib/contracts/agent-events";

export type PortfolioWorkspaceInput = {
    holdings: Array<{
        schemeName: string;
        schemeCode: string | null;
        marketValue: number;
    }>;
    totalValue: number;
    inflationRate: number;
    inflationConfidence: string;
    realReturn: number | null;
    coverageRatio: number;
    equityWeight: number;
    buckets: Array<{ bucket: string; weight: number }>;
    insight: { title: string; template: string } | null;
};

function formatCompact(n: number): string {
    if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
    if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(Math.round(n));
}

export function buildPortfolioWorkspaceState(
    input: PortfolioWorkspaceInput,
): WorkspaceState {
    const now = new Date();

    const midSmallWeight = input.buckets
        .filter(
            (b) =>
                b.bucket === "Equity - Mid Cap" ||
                b.bucket === "Equity - Small Cap",
        )
        .reduce((sum, b) => sum + b.weight, 0);

    const agents: AgentState[] = [
        {
            name: "Portfolio Analyst" as AgentName,
            status: "complete",
            currentTask: "Portfolio holdings mapped",
            evidence: [
                { label: "Holdings", value: String(input.holdings.length) },
                { label: "Total value", value: `₹${formatCompact(input.totalValue)}` },
            ],
            nextStep: "Hand over to Performance Analyst for return analysis",
            progress: 100,
        },
        {
            name: "Inflation Analyst" as AgentName,
            status: "complete",
            currentTask: "Personal inflation rate ready",
            evidence: [
                {
                    label: "Personal inflation",
                    value: `${(input.inflationRate * 100).toFixed(2)}%`,
                },
                { label: "Confidence", value: input.inflationConfidence },
            ],
            nextStep: "Share rate with Performance Analyst",
            progress: 100,
        },
        {
            name: "Performance Analyst" as AgentName,
            status: "complete",
            currentTask: "Real-return analysis complete",
            evidence: [
                {
                    label: "Real return",
                    value:
                        input.realReturn !== null
                            ? `${(input.realReturn * 100).toFixed(2)}%`
                            : "—",
                },
                {
                    label: "Coverage",
                    value: `${Math.round(input.coverageRatio * 100)}%`,
                },
            ],
            nextStep: "Summarise findings for Copilot",
            progress: 100,
        },
        {
            name: "Risk Analyst" as AgentName,
            status: "complete",
            currentTask: "Risk review complete",
            evidence: [
                {
                    label: "Equity exposure",
                    value: `${(input.equityWeight * 100).toFixed(1)}%`,
                },
                {
                    label: "Mid/small exposure",
                    value: `${(midSmallWeight * 100).toFixed(1)}%`,
                },
            ],
            nextStep: "Return risk summary to Copilot",
            progress: 100,
        },
        {
            name: "Copilot" as AgentName,
            status: "complete",
            currentTask: "Synthesis complete",
            evidence: input.insight
                ? [{ label: "Insight", value: input.insight.title }]
                : [{ label: "View", value: "Portfolio summary" }],
            nextStep: "Render portfolio view",
            progress: 100,
        },
    ];

    const activity: ActivityItem[] = agents.map((agent) => ({
        id: `${agent.name}-complete`,
        timestamp: now,
        agent: agent.name,
        message: `${agent.name} completed: ${agent.currentTask.toLowerCase()}`,
        evidence: agent.evidence,
    }));

    if (input.insight) {
        activity.push({
            id: "insight-generated",
            timestamp: now,
            agent: "Copilot",
            message: `Generated insight: ${input.insight.title}`,
            evidence: [{ label: "Template", value: input.insight.template }],
        });
    }

    activity.push({
        id: "copilot-render",
        timestamp: now,
        agent: "Copilot",
        message: "Copilot rendered the portfolio view",
        evidence: [{ label: "Sections", value: "Holdings, allocation, timeline" }],
    });

    const copilotStatus = deriveCopilotStatus(agents, true);
    const summary = formatWorkspaceSummary(agents);

    return { copilotStatus, agents, activity, summary };
}
