// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { Agent } from './Agent.js';
import { DESK_POSITIONS } from '../canvas/scenes/office.js';

export class AgentManager {
  constructor() {
    this.agents = {};
    Object.entries(DESK_POSITIONS).forEach(([id, pos]) => {
      this.agents[id] = new Agent(id, pos);
    });
  }

  get(agentId) { return this.agents[agentId]; }
  all() { return Object.values(this.agents); }

  update(deltaMs) {
    this.all().forEach(agent => agent.update(deltaMs));
  }

  draw(ctx, spriteSheet) {
    // Draw in z-order: higher y = drawn later (appears in front)
    this.all()
      .sort((a, b) => a.y - b.y)
      .forEach(agent => agent.draw(ctx, spriteSheet));
  }
}
