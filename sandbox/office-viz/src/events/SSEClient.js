// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { eventBus } from './EventBus.js';

export class SSEClient {
  constructor(url = '/api/pipeline/events') {
    this.url = url;
    this.source = null;
    this.connected = false;
  }

  connect(runId) {
    const url = runId ? `${this.url}?runId=${runId}` : this.url;
    this.source = new EventSource(url);

    this.source.onopen = () => {
      this.connected = true;
      eventBus.emit('SSE_CONNECTED', { url });
    };

    this.source.onerror = () => {
      this.connected = false;
      eventBus.emit('SSE_ERROR', { url });
      // Auto-fallback to mock mode
      eventBus.emit('SWITCH_TO_MOCK', {});
    };

    // Map SSE event types to EventBus events
    const eventTypes = [
      'PIPELINE_STARTED', 'AGENT_ACTIVATED', 'AGENT_THINKING',
      'AGENT_DONE', 'VOTE_CALLED', 'VOTE_CAST',
      'PIPELINE_APPROVED', 'PIPELINE_DEADLOCKED'
    ];

    eventTypes.forEach(type => {
      this.source.addEventListener(type, (e) => {
        try {
          const data = JSON.parse(e.data);
          eventBus.emit(type, data);
        } catch (err) {
          console.error(`[SSE] Failed to parse ${type}:`, err);
        }
      });
    });
  }

  disconnect() {
    if (this.source) {
      this.source.close();
      this.source = null;
      this.connected = false;
    }
  }
}
