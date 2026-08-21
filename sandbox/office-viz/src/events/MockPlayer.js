// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { eventBus } from './EventBus.js';

export class MockPlayer {
  constructor(events) {
    this.events = events;           // array from mock-events.json
    this.startTime = null;
    this.currentIndex = 0;
    this.playing = false;
    this.speed = 1;                 // playback speed multiplier
    this.rafId = null;
    this.currentOffset = 0;
  }

  play(speed = 1) {
    this.speed = speed;
    this.playing = true;
    this.startTime = performance.now() - (this.currentOffset || 0);
    this.tick();
  }

  pause() {
    this.playing = false;
    this.currentOffset = performance.now() - this.startTime;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  reset() {
    this.pause();
    this.currentIndex = 0;
    this.currentOffset = 0;
    this.startTime = null;
  }

  tick() {
    if (!this.playing) return;

    const elapsed = (performance.now() - this.startTime) * this.speed;

    while (
      this.currentIndex < this.events.length &&
      this.events[this.currentIndex].t <= elapsed
    ) {
      const event = this.events[this.currentIndex];
      eventBus.emit(event.type, { ...event.payload, agentId: event.agentId });
      this.currentIndex++;
    }

    if (this.currentIndex < this.events.length) {
      this.rafId = requestAnimationFrame(() => this.tick());
    } else {
      this.playing = false;
      eventBus.emit('PLAYBACK_COMPLETE', {});
    }
  }

  get progress() {
    if (!this.events.length) return 0;
    return this.currentIndex / this.events.length;
  }
}
