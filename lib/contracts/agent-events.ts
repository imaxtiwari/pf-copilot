/**
 * Structured agent activity contracts for the AI Workspace UI.
 *
 * These types describe the visual state of the analyst team and the
 * chronological activity feed. In milestone 1 they are built synchronously
 * from the orchestrator's ToolTrace[]; in milestone 2 they are fed by
 * real-time backend agent events.
 */

export type AgentName =
    | "Portfolio Analyst"
    | "Inflation Analyst"
    | "Performance Analyst"
    | "Fund Research Agent"
    | "Risk Analyst"
    | "Copilot";

export type AgentStatus = "working" | "complete" | "queued" | "waiting" | "idle";

export type CopilotStatus =
    | "analysing"
    | "researching"
    | "cross-checking"
    | "synthesizing"
    | "complete";

export type Evidence = {
    /** Human-readable label, e.g. "Holdings" or "Personal inflation" */
    label: string;
    /** Compact value, e.g. "14" or "6.8%" */
    value: string;
    /** Optional link to evidence source */
    href?: string;
};

export type AgentState = {
    name: AgentName;
    status: AgentStatus;
    /** One-line description of what the agent is currently doing */
    currentTask: string;
    /** Data points that ground this agent's work */
    evidence: Evidence[];
    /** One-line description of what the agent will do next */
    nextStep: string;
    /** Optional 0-100 progress indicator */
    progress?: number;
};

export type ActivityItem = {
    /** Stable id for React keys */
    id: string;
    timestamp: Date;
    agent: AgentName;
    /** Human-readable sentence describing the event */
    message: string;
    evidence?: Evidence[];
};

export type WorkspaceState = {
    copilotStatus: CopilotStatus;
    agents: AgentState[];
    activity: ActivityItem[];
    /** e.g. "Your financial team is working · 3 working · 2 complete · 1 waiting" */
    summary: string;
};

// ── milestone 2: real-time events from the backend ───────────────────────────

export type AgentEventBase = {
    id: string;
    timestamp: Date;
    agent: AgentName;
};

export type AgentStartedEvent = AgentEventBase & {
    type: "agent_started";
    task: string;
};

export type ToolCalledEvent = AgentEventBase & {
    type: "tool_called";
    tool: string;
    args?: unknown;
};

export type ToolCompletedEvent = AgentEventBase & {
    type: "tool_completed";
    tool: string;
    success: boolean;
    error?: string;
};

export type FindingCreatedEvent = AgentEventBase & {
    type: "finding_created";
    finding: string;
    evidence: Evidence[];
};

export type AgentCompletedEvent = AgentEventBase & {
    type: "agent_completed";
    summary: string;
};

export type CopilotStatusEvent = {
    type: "copilot_status";
    id: string;
    timestamp: Date;
    status: CopilotStatus;
};

export type AgentEvent =
    | AgentStartedEvent
    | ToolCalledEvent
    | ToolCompletedEvent
    | FindingCreatedEvent
    | AgentCompletedEvent
    | CopilotStatusEvent;
