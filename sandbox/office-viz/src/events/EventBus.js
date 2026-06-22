// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

export class EventBus {
  constructor() {
    this.listeners = {};
  }

  on(eventType, callback) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    if (this.listeners[eventType]) {
      this.listeners[eventType] =
        this.listeners[eventType].filter(cb => cb !== callback);
    }
  }

  emit(eventType, payload) {
    (this.listeners[eventType] || []).forEach(cb => cb(payload));
    (this.listeners['*'] || []).forEach(cb => cb({ type: eventType, payload }));
  }
}

export const eventBus = new EventBus();
