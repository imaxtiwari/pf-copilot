// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { drawAgent, FRAME } from '../canvas/sprites.js';

export class Agent {
  constructor(id, deskPosition) {
    this.id = id;
    this.desk = deskPosition;
    this.x = deskPosition.x;
    this.y = deskPosition.y;
    this.state = 'IDLE';       // IDLE | ACTIVE | WALKING | VOTING
    this.frame = 0;            // current sprite frame
    this.frameTimer = 0;       // ms since last frame change
    this.frameDuration = 200;  // ms per idle animation frame
    this.thoughtBubble = null; // ThoughtBubble instance or null
    this.walkTarget = null;    // { x, y } destination or null
    this.walkSpeed = 80;       // pixels per second
    this._onArrival = null;
  }

  setState(newState) {
    this.state = newState;
    this.frame = newState === 'IDLE' ? 0 : 1;
  }

  update(deltaMs) {
    // Walking logic
    if (this.state === 'WALKING' && this.walkTarget) {
      const dx = this.walkTarget.x - this.x;
      const dy = this.walkTarget.y - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const step = this.walkSpeed * (deltaMs / 1000);

      if (dist <= step) {
        this.x = this.walkTarget.x;
        this.y = this.walkTarget.y;
        this.walkTarget = null;
        this.setState('VOTING');
        if (this._onArrival) {
          this._onArrival();
          this._onArrival = null;
        }
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.frame = dx < 0 ? FRAME.WALK_LEFT : FRAME.WALK_RIGHT;
      }
    }

    // Idle animation (gentle bob between frame 0 and 1)
    if (this.state === 'IDLE') {
      this.frameTimer += deltaMs;
      if (this.frameTimer > this.frameDuration * 3) {
        this.frame = this.frame === 0 ? 1 : 0;
        this.frameTimer = 0;
      }
    }

    // Update thought bubble if present
    if (this.thoughtBubble) {
      this.thoughtBubble.update(deltaMs);
    }
  }

  walkTo(target, onArrival) {
    this.walkTarget = target;
    this.state = 'WALKING';
    this._onArrival = onArrival;
  }

  draw(ctx, spriteSheet) {
    drawAgent(ctx, spriteSheet, this.id, this.frame, this.x, this.y);
    if (this.thoughtBubble) {
      this.thoughtBubble.draw(ctx, this.x, this.y - 60);
    }
  }
}
