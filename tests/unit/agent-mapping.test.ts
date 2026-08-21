import { describe, expect, it } from "vitest";
import {
    buildActivityFeed,
    buildWorkspaceState,
    deriveCopilotStatus,
    formatWorkspaceSummary,
    getAllAgentNames,
    mapToolNameToAgentName,
    mapToolTraceToAgentStates,
} from "@/lib/agent-mapping";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import type { ToolTrace } from "@/lib/orchestrator";
import type { AgentName, AgentState } from "@/lib/contracts/agent-events";

const portfolioTrace: ToolTrace = {
    tool: "get_portfolio",
    args: {},
    result: {
        holdings: [
            { scheme_name: "Nifty 50 Index Fund", scheme_code: "120503", market_value: 250000 },
            { scheme_name: "Mid Cap Fund", scheme_code: "118825", market_value: 150000 },
            { scheme_name: "Small Cap Fund", scheme_code: "125494", market_value: 80000 },
        ],
        truncated: { count: 2, total_value: 30000 },
        total_value: 510000,
        asset_mix: { Equity: 85, Debt: 15 },
    },
};

const inflationTrace: ToolTrace = {
    tool: "compute_personal_inflation",
    args: {},
    result: {
        inflation_rate: 6.8,
        confidence: "high",
        breakdown: [{ sleeve: "housing", weight: 0.35, rate: 8.2, contribution: 2.9 }],
        computed_at: "2026-01-01T00:00:00Z",
        note: null,
    },
};

const realReturnsTrace: ToolTrace = {
    tool: "compute_real_returns",
    args: { scheme_code: "120503" },
    result: {
        scheme_code: "120503",
        scheme_name: "Nifty 50 Index Fund",
        your_holding: { units: 100, nav: 2500, market_value: 250000, as_of_date: "2026-07-26" },
        personal_inflation_rate: 6.8,
        inflation_confidence: "high",
        factsheet_returns_data: "1Y: 18.2%",
        real_return_formula: "real_return = (1 + nominal_return) / (1 + personal_inflation_rate) - 1",
        coverage_ratio: 1,
        excluded_funds: [],
        note: null,
    },
};

const explainFundTrace: ToolTrace = {
    tool: "explain_fund",
    args: { scheme_code: "120503", question: "What is the expense ratio?" },
    result: {
        scheme_name: "Nifty 50 Index Fund",
        scheme_code: "120503",
        answer: "Expense ratio is 0.2%",
        citations: [{ source: "AMFI factsheet", chunk: "expense ratio 0.2%" }],
    },
};

const explainStockTrace: ToolTrace = {
    tool: "explain_stock",
    args: { isin: "INE002A01018", question: "What is the debt?" },
    result: {
        isin: "INE002A01018",
        company_name: "Reliance Industries",
        answer: "Debt is low.",
        citations: [{ source: "Annual report", chunk: "debt" }],
    },
};

const compareFundsTrace: ToolTrace = {
    tool: "compare_funds",
    args: { scheme_codes: ["120503", "118825"], question: "Which is better?" },
    result: {
        comparison: "Nifty 50 has lower expense ratio.",
        citations: [{ source: "AMFI factsheet", chunk: "comparison" }],
    },
};

const chatHistoryTrace: ToolTrace = {
    tool: "lookup_chat_history",
    args: {},
    result: {
        messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ],
    },
};

describe("tool → agent mapping", () => {
    it("maps every defined tool to a valid agent", () => {
        for (const tool of TOOL_DEFINITIONS) {
            if (tool.type !== "function") continue;
            const name = tool.function.name;
            const agent = mapToolNameToAgentName(name);
            expect(getAllAgentNames()).toContain(agent);
        }
    });

    it("maps known tools to the expected analysts", () => {
        expect(mapToolNameToAgentName("get_portfolio")).toBe("Portfolio Analyst");
        expect(mapToolNameToAgentName("compute_personal_inflation")).toBe("Inflation Analyst");
        expect(mapToolNameToAgentName("compute_real_returns")).toBe("Performance Analyst");
        expect(mapToolNameToAgentName("explain_fund")).toBe("Fund Research Agent");
        expect(mapToolNameToAgentName("compare_funds")).toBe("Fund Research Agent");
        expect(mapToolNameToAgentName("explain_stock")).toBe("Risk Analyst");
        expect(mapToolNameToAgentName("lookup_chat_history")).toBe("Copilot");
    });

    it("falls unknown tools back to Copilot", () => {
        expect(mapToolNameToAgentName("made_up_tool")).toBe("Copilot");
    });
});

describe("agent state derivation", () => {
    it("returns all six agents for any non-empty trace set", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        expect(states).toHaveLength(6);
        expect(states.map((s) => s.name)).toEqual(getAllAgentNames());
    });

    it("marks agents without traces as idle", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        const inflation = states.find((s) => s.name === "Inflation Analyst");
        expect(inflation?.status).toBe("idle");
        expect(inflation?.currentTask).toBe("Standing by");
    });

    it("marks a completed portfolio trace as complete", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        const portfolio = states.find((s) => s.name === "Portfolio Analyst");
        expect(portfolio?.status).toBe("complete");
        expect(portfolio?.progress).toBe(100);
    });

    it("extracts portfolio evidence (holdings count, total value, top holdings)", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        const portfolio = states.find((s) => s.name === "Portfolio Analyst")!;
        expect(portfolio.evidence).toContainEqual({ label: "Holdings", value: "3" });
        expect(portfolio.evidence).toContainEqual({ label: "Total value", value: "₹5.1L" });
        expect(portfolio.evidence.some((e) => e.label === "Holding" && e.value.includes("Nifty 50"))).toBe(true);
        expect(portfolio.evidence).toContainEqual({ label: "Truncated tail", value: "2" });
    });

    it("extracts inflation evidence (rate and confidence)", () => {
        const states = mapToolTraceToAgentStates([inflationTrace]);
        const inflation = states.find((s) => s.name === "Inflation Analyst")!;
        expect(inflation.evidence).toContainEqual({ label: "Personal inflation", value: "6.8%" });
        expect(inflation.evidence).toContainEqual({ label: "Confidence", value: "high" });
    });

    it("extracts performance evidence (inflation applied, coverage, holding value)", () => {
        const states = mapToolTraceToAgentStates([realReturnsTrace]);
        const performance = states.find((s) => s.name === "Performance Analyst")!;
        expect(performance.evidence).toContainEqual({ label: "Inflation applied", value: "6.8%" });
        expect(performance.evidence).toContainEqual({ label: "Coverage", value: "100%" });
        expect(performance.evidence.some((e) => e.label === "Holding value")).toBe(true);
    });

    it("extracts fund research evidence (scheme, AMFI code, citations)", () => {
        const states = mapToolTraceToAgentStates([explainFundTrace]);
        const research = states.find((s) => s.name === "Fund Research Agent")!;
        expect(research.evidence).toContainEqual({ label: "Scheme", value: "Nifty 50 Index Fund" });
        expect(research.evidence).toContainEqual({ label: "AMFI code", value: "120503" });
        expect(research.evidence).toContainEqual({ label: "Cited sources", value: "1" });
    });

    it("extracts risk analyst evidence (ISIN, company, citations)", () => {
        const states = mapToolTraceToAgentStates([explainStockTrace]);
        const risk = states.find((s) => s.name === "Risk Analyst")!;
        expect(risk.evidence).toContainEqual({ label: "ISIN", value: "INE002A01018" });
        expect(risk.evidence).toContainEqual({ label: "Company", value: "Reliance Industries" });
        expect(risk.evidence).toContainEqual({ label: "Cited sources", value: "1" });
    });

    it("extracts copilot evidence (turns recalled)", () => {
        const states = mapToolTraceToAgentStates([chatHistoryTrace]);
        const copilot = states.find((s) => s.name === "Copilot")!;
        expect(copilot.evidence).toContainEqual({ label: "Turns recalled", value: "2" });
    });
});

describe("workspace state", () => {
    it("builds an idle workspace state for empty traces", () => {
        const state = buildWorkspaceState([], undefined, false);
        expect(state.agents).toHaveLength(6);
        expect(state.agents.every((a) => a.status === "idle")).toBe(true);
        expect(state.copilotStatus).toBe("analysing");
        expect(state.activity).toHaveLength(0);
        expect(state.summary).toBe("Your financial team · 0 working · 0 complete");
    });

    it("builds a complete workspace state for completed traces", () => {
        const traces: ToolTrace[] = [portfolioTrace, inflationTrace, realReturnsTrace];
        const state = buildWorkspaceState(traces, "Here is your summary.", true);
        expect(state.copilotStatus).toBe("complete");
        expect(state.agents.filter((a) => a.status === "complete")).toHaveLength(3);
        expect(state.activity.some((i) => i.agent === "Copilot")).toBe(true);
        expect(state.summary).toContain("3 complete");
    });

    it("summarises complete statuses", () => {
        const traces: ToolTrace[] = [portfolioTrace, inflationTrace];
        const state = buildWorkspaceState(traces, undefined, false);
        expect(state.summary).toBe("Your financial team · 2 complete");
    });
});

describe("copilot status", () => {
    it("is complete when the turn is complete", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        expect(deriveCopilotStatus(states, true)).toBe("complete");
    });

    it("is researching when fund or risk agents are working", () => {
        const workingFundTrace: ToolTrace = {
            ...explainFundTrace,
            result: null as unknown as Record<string, unknown>,
        };
        const states = mapToolTraceToAgentStates([workingFundTrace]);
        expect(deriveCopilotStatus(states, false)).toBe("researching");
    });

    it("is analysing when performance or inflation analysts are working", () => {
        const workingInflationTrace: ToolTrace = {
            ...inflationTrace,
            result: null as unknown as Record<string, unknown>,
        };
        const states = mapToolTraceToAgentStates([workingInflationTrace]);
        expect(deriveCopilotStatus(states, false)).toBe("analysing");
    });

    it("is cross-checking when agents are waiting with no active worker", () => {
        const waitingRealReturnsTrace: ToolTrace = {
            tool: "compute_real_returns",
            args: { scheme_code: "120503" },
            result: null as unknown as Record<string, unknown>,
        };
        const states: AgentState[] = [
            { name: "Portfolio Analyst", status: "complete", currentTask: "done", evidence: [], nextStep: "" },
            { name: "Performance Analyst", status: "waiting", currentTask: "waiting", evidence: [], nextStep: "" },
            { name: "Inflation Analyst", status: "idle", currentTask: "", evidence: [], nextStep: "" },
            { name: "Fund Research Agent", status: "idle", currentTask: "", evidence: [], nextStep: "" },
            { name: "Risk Analyst", status: "idle", currentTask: "", evidence: [], nextStep: "" },
            { name: "Copilot", status: "idle", currentTask: "", evidence: [], nextStep: "" },
        ];
        expect(deriveCopilotStatus(states, false)).toBe("cross-checking");
    });

    it("is synthesizing when at least one agent is complete and none are working", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        expect(deriveCopilotStatus(states, false)).toBe("synthesizing");
    });
});

describe("activity feed", () => {
    it("includes one entry per non-idle agent", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace, inflationTrace]);
        const feed = buildActivityFeed(states);
        expect(feed).toHaveLength(2);
        expect(feed.every((i) => i.message.length > 0)).toBe(true);
    });

    it("adds a copilot synthesis entry when assistant message is provided", () => {
        const states = mapToolTraceToAgentStates([portfolioTrace]);
        const feed = buildActivityFeed(states, "Final answer here.");
        expect(feed.some((i) => i.agent === "Copilot")).toBe(true);
    });
});
