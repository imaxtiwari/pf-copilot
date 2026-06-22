// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

export const AGENT_ROW = {
  DHRUV: 0, PRIYA: 1, ARIA: 2, KIRAN: 3,
  VIKRAM: 4, SOMA: 5, RIYA: 6, MENTOR: 7
};

export const FRAME = {
  IDLE: 0,
  ACTIVE: 1,
  WALK_LEFT: 2,
  WALK_RIGHT: 3
};

export const SPRITE_SIZE = 32;

export function loadSpriteSheet(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function drawAgent(ctx, spriteSheet, agentId, frame, x, y, scale = 1) {
  if (!spriteSheet) {
    // Fallback: colored rectangle with agent initial
    drawAgentFallback(ctx, agentId, x, y, scale);
    return;
  }
  const row = AGENT_ROW[agentId];
  if (row === undefined) {
    // Handle system or ATLAS or other non-agent cases gracefully
    drawAgentFallback(ctx, agentId, x, y, scale);
    return;
  }
  const srcX = frame * SPRITE_SIZE;
  const srcY = row * SPRITE_SIZE;
  
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    spriteSheet,
    srcX, srcY, SPRITE_SIZE, SPRITE_SIZE,
    Math.floor(x), Math.floor(y),
    SPRITE_SIZE * scale, SPRITE_SIZE * scale
  );
}

const AGENT_COLORS = {
  DHRUV: '#1a237e', PRIYA: '#00695c', ARIA: '#b71c1c',
  KIRAN: '#4a148c', VIKRAM: '#e65100', SOMA: '#2e7d32',
  RIYA: '#6a1b9a', MENTOR: '#4e342e', ATLAS: '#37474f' // Added ATLAS fallback
};

function drawAgentFallback(ctx, agentId, x, y, scale) {
  // Draw colored square with agent initial
  // Used when sprite sheet not yet loaded
  const color = AGENT_COLORS[agentId] || '#37474f';
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y),
    SPRITE_SIZE * scale, SPRITE_SIZE * scale);
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    agentId ? agentId[0] : '?',
    Math.floor(x + (SPRITE_SIZE * scale) / 2),
    Math.floor(y + (SPRITE_SIZE * scale) / 2 + 4)
  );
}
