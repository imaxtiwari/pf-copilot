# pf-copilot Office Visualization Sandbox

Standalone pixel art office visualization for the pf-copilot multi-agent pipeline.

## Setup
```bash
cd sandbox/office-viz
npm install
npm run dev
```

## Requirements
- Node 18+
- pf-copilot main app running on port 3000 (for live mode)
- Or run standalone — will auto-fall back to playback mode

## Branch
This sandbox lives on: `sandbox/office-viz`
Never merge into main.
Experiment freely.

## Modes
- **LIVE** — connects to real pipeline via SSE proxy
- **PLAYBACK** — replays mock-events.json (Rohan Mehta pipeline run)
- **IDLE** — playback complete, hit replay to restart

## Adding new agents or events
1. Add agent to `AGENT_ROW` in `sprites.js`
2. Add desk position to `DESK_POSITIONS` in `office.js`
3. Add event handler in `renderer.js` `bindEvents()`
4. Add events to `mock-events.json` for playback testing
