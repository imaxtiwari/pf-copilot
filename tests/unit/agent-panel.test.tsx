import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AgentState, WorkspaceState, CopilotStatus } from "@/lib/contracts/agent-events";
import { AgentAvatar } from "@/components/agent-avatar";
import { EvidenceChip } from "@/components/evidence-chip";
import { CopilotStatusPill } from "@/components/copilot-status";
import { AgentCard } from "@/components/agent-card";
import { AgentActivityPanel } from "@/components/agent-activity-panel";

const STATUS_LABELS: Record<CopilotStatus, string> = {
    analysing: "Analysing",
    researching: "Researching",
    "cross-checking": "Cross-checking",
    synthesizing: "Synthesizing",
    complete: "Complete",
};

const mockAgent: AgentState = {
    name: "Portfolio Analyst",
    status: "working",
    currentTask: "Reviewing portfolio structure",
    evidence: [
        { label: "Holdings", value: "24" },
        { label: "Total value", value: "₹18.4L", href: "/portfolio" },
    ],
    nextStep: "Compare sector exposure",
    progress: 50,
};

const mockWorkspace: WorkspaceState = {
    copilotStatus: "analysing",
    agents: [
        mockAgent,
        {
            name: "Inflation Analyst",
            status: "complete",
            currentTask: "Personal inflation calculated",
            evidence: [{ label: "Personal inflation", value: "6.9%" }],
            nextStep: "Share with performance analyst",
        },
        {
            name: "Risk Analyst",
            status: "waiting",
            currentTask: "Waiting for portfolio analysis",
            evidence: [],
            nextStep: "Check concentration",
        },
        {
            name: "Performance Analyst",
            status: "idle",
            currentTask: "Standing by",
            evidence: [],
            nextStep: "Will activate if needed",
        },
        {
            name: "Fund Research Agent",
            status: "idle",
            currentTask: "Standing by",
            evidence: [],
            nextStep: "Will activate if needed",
        },
        {
            name: "Copilot",
            status: "idle",
            currentTask: "Standing by",
            evidence: [],
            nextStep: "Will activate if needed",
        },
    ],
    activity: [
        {
            id: "1",
            timestamp: new Date("2026-07-26T10:42:03Z"),
            agent: "Copilot",
            message: "Started portfolio analysis",
        },
        {
            id: "2",
            timestamp: new Date("2026-07-26T10:42:04Z"),
            agent: "Portfolio Analyst",
            message: "Loaded 24 holdings",
            evidence: [{ label: "Holdings", value: "24" }],
        },
    ],
    summary: "Your financial team is working · 1 working · 1 complete · 1 waiting",
};

describe("AgentAvatar", () => {
    it("renders initials and title for each agent", () => {
        render(<AgentAvatar name="Portfolio Analyst" />);
        expect(screen.getByLabelText("Portfolio Analyst")).toHaveTextContent("PA");
    });
});

describe("EvidenceChip", () => {
    it("renders label and value", () => {
        render(<EvidenceChip evidence={{ label: "Holdings", value: "24" }} />);
        expect(screen.getByText("Holdings:")).toBeInTheDocument();
        expect(screen.getByText("24")).toBeInTheDocument();
    });

    it("renders a link when href is provided", () => {
        render(<EvidenceChip evidence={{ label: "Total value", value: "₹18.4L", href: "/portfolio" }} />);
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", "/portfolio");
    });
});

describe("CopilotStatusPill", () => {
    const statuses: CopilotStatus[] = ["analysing", "researching", "cross-checking", "synthesizing", "complete"];

    statuses.forEach((status) => {
        it(`renders accessible label for ${status}`, () => {
            const label = STATUS_LABELS[status];
            const { container } = render(<CopilotStatusPill status={status} />);
            const pill = container.querySelector(`[aria-label="Copilot status: ${label}"]`);
            expect(pill).toBeInTheDocument();
        });
    });
});

describe("AgentCard", () => {
    it("renders name, status, and current task", () => {
        render(<AgentCard agent={mockAgent} />);
        expect(screen.getByText("Portfolio Analyst")).toBeInTheDocument();
        expect(screen.getByText("Working")).toBeInTheDocument();
        expect(screen.getByText("Reviewing portfolio structure")).toBeInTheDocument();
    });

    it("expands to reveal evidence and next step", () => {
        const { container } = render(<AgentCard agent={mockAgent} />);
        const button = container.querySelector('[data-agent-card="Portfolio Analyst"]') as HTMLElement;
        fireEvent.click(button);
        expect(container.querySelector('[data-testid="agent-next-step"]')).toHaveTextContent("Compare sector exposure");
        expect(container.querySelector('[data-testid="agent-evidence"]')).toBeInTheDocument();
    });
});

describe("AgentActivityPanel", () => {
    it("renders all agent cards in expanded mode", () => {
        const { container } = render(<AgentActivityPanel state={mockWorkspace} expanded />);
        expect(container.querySelector('[data-agent-card="Portfolio Analyst"]')).toBeInTheDocument();
        expect(container.querySelector('[data-agent-card="Inflation Analyst"]')).toBeInTheDocument();
        expect(container.querySelector('[data-agent-card="Risk Analyst"]')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="activity-section"]')).toBeInTheDocument();
    });

    it("hides activity feed in compact mode", () => {
        const { container } = render(<AgentActivityPanel state={mockWorkspace} expanded={false} />);
        expect(container.querySelector('[data-testid="activity-section"]')).not.toBeInTheDocument();
        expect(screen.getByText(/Working now:/)).toBeInTheDocument();
    });
});
