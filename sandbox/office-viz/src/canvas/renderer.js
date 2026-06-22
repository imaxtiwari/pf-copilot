// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { AgentManager } from '../agents/AgentManager.js';
import { ThoughtBubble } from '../bubbles/ThoughtBubble.js';
import { drawOffice, BOARDROOM } from './scenes/office.js';
import {
  drawBoardroom,
  setBoardroomVisible,
  setVoteCard,
  setBoardroomOutcome,
  resetBoardroom
} from './scenes/boardroom.js';
import { loadSpriteSheet } from './sprites.js';
import { eventBus } from '../events/EventBus.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.agentManager = new AgentManager();
    this.spriteSheet = null;
    this.lastTime = null;
    this.rafId = null;
    this.boardroomActive = false;
    this.pipelineOutcome = null;  // 'APPROVED' | 'DEADLOCKED' | null
    this.flashTimer = 0;
    this.confettiParticles = [];

    this.bindEvents();
  }

  async loadAssets() {
    try {
      this.spriteSheet = await loadSpriteSheet('/src/assets/sprites/agents.png');
    } catch {
      console.warn('[Renderer] Sprite sheet not found — using fallback colors');
    }
  }

  bindEvents() {
    eventBus.on('AGENT_ACTIVATED', ({ agentId, stage }) => {
      const agent = this.agentManager.get(agentId);
      if (!agent) return;
      agent.setState('ACTIVE');
      agent.thoughtBubble = new ThoughtBubble();
      agent.thoughtBubble.setText(`${stage}...`);
      agent.thoughtBubble.setType('THINKING');
    });

    eventBus.on('AGENT_THINKING', ({ agentId, text, append }) => {
      const agent = this.agentManager.get(agentId);
      if (!agent?.thoughtBubble) return;
      agent.thoughtBubble.setText(text, append);
    });

    eventBus.on('AGENT_DONE', ({ agentId, outcome }) => {
      const agent = this.agentManager.get(agentId);
      if (!agent) return;
      if (agent.thoughtBubble) {
        const typeMap = {
          SUCCESS: 'SUCCESS', FAULT: 'FAULT', WARN: 'WARN'
        };
        agent.thoughtBubble.setType(typeMap[outcome] || 'THINKING');
        setTimeout(() => {
          agent.thoughtBubble?.startFade();
          setTimeout(() => {
            agent.setState('IDLE');
            agent.thoughtBubble = null;
          }, 1000);
        }, 2000);
      }
    });

    eventBus.on('VOTE_CALLED', ({ draftVersion, confidenceScore }) => {
      this.boardroomActive = true;
      setBoardroomVisible(true);
      const voters = ['ARIA', 'KIRAN', 'VIKRAM'];

      voters.forEach((agentId, i) => {
        const agent = this.agentManager.get(agentId);
        const target = BOARDROOM.chairPositions[i];
        setTimeout(() => {
          if (agent.thoughtBubble) {
            agent.thoughtBubble.startFade();
            agent.thoughtBubble = null;
          }
          agent.walkTo(target);
        }, i * 400);
      });

      // DHRUV walks to head of table
      setTimeout(() => {
        const dhruv = this.agentManager.get('DHRUV');
        dhruv.walkTo(BOARDROOM.chairPositions[3]);
      }, 600);
    });

    eventBus.on('VOTE_CAST', ({ agentId, vote }) => {
      const agent = this.agentManager.get(agentId);
      if (!agent) return;
      setVoteCard(agentId, vote);
      agent.thoughtBubble = new ThoughtBubble();
      agent.thoughtBubble.setType(vote === 'APPROVE' ? 'SUCCESS' : 'FAULT');
      agent.thoughtBubble.setText(vote === 'APPROVE' ? '✓ APPROVE' : '✗ REJECT');
    });

    eventBus.on('PIPELINE_APPROVED', () => {
      this.pipelineOutcome = 'APPROVED';
      setBoardroomOutcome('APPROVED');
      this.startConfetti();
      setTimeout(() => this.agentsReturnToDesks(), 3000);
    });

    eventBus.on('PIPELINE_DEADLOCKED', () => {
      this.pipelineOutcome = 'DEADLOCKED';
      setBoardroomOutcome('DEADLOCKED');
      this.flashTimer = 1200;  // red flash duration ms
      setTimeout(() => this.agentsReturnToDesks(), 3000);
    });
  }

  agentsReturnToDesks() {
    const voters = ['ARIA', 'KIRAN', 'VIKRAM', 'DHRUV'];
    voters.forEach((agentId, i) => {
      const agent = this.agentManager.get(agentId);
      if (!agent) return;
      setTimeout(() => {
        if (agent.thoughtBubble) {
          agent.thoughtBubble.startFade();
          agent.thoughtBubble = null;
        }
        agent.walkTo(agent.desk, () => agent.setState('IDLE'));
      }, i * 300);
    });
    setTimeout(() => {
      this.boardroomActive = false;
      this.pipelineOutcome = null;
      resetBoardroom();
    }, 5000);
  }


  startConfetti() {
    this.confettiParticles = Array.from({ length: 80 }, () => ({
      x: Math.random() * this.canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 60,
      vy: Math.random() * 120 + 60,
      color: ['#ffd700','#ff6b6b','#4ecdc4','#45b7d1','#96ceb4'][
        Math.floor(Math.random() * 5)
      ],
      size: Math.floor(Math.random() * 4) + 2,
      life: 1
    }));
  }

  start() {
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  loop(timestamp) {
    const deltaMs = Math.min(timestamp - this.lastTime, 50);
    this.lastTime = timestamp;

    this.update(deltaMs);
    this.draw();

    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  update(deltaMs) {
    this.agentManager.update(deltaMs);

    // Update confetti
    this.confettiParticles = this.confettiParticles.filter(p => {
      p.x += p.vx * (deltaMs / 1000);
      p.y += p.vy * (deltaMs / 1000);
      p.life -= deltaMs / 3000;
      return p.life > 0 && p.y < this.canvas.height;
    });

    if (this.flashTimer > 0) this.flashTimer -= deltaMs;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    drawOffice(ctx);
    if (this.boardroomActive) drawBoardroom(ctx);
    this.agentManager.draw(ctx, this.spriteSheet);

    // Red flash overlay on deadlock
    if (this.flashTimer > 0) {
      ctx.fillStyle = `rgba(200,0,0,${(this.flashTimer / 1200) * 0.3})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Confetti
    this.confettiParticles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }
}
