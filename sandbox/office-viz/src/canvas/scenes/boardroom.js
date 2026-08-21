// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import { BOARDROOM } from './office.js';

// Vote card state per voter
let voteCards = {
  ARIA:   { state: 'HIDDEN', vote: null },  // HIDDEN | FACE_DOWN | REVEALED
  KIRAN:  { state: 'HIDDEN', vote: null },
  VIKRAM: { state: 'HIDDEN', vote: null },
};

let boardroomVisible = false;
let outcomeLabel = null;   // 'APPROVED' | 'DEADLOCKED' | null

export function setBoardroomVisible(v) { boardroomVisible = v; }

export function setVoteCard(agentId, vote) {
  voteCards[agentId] = { state: 'FACE_DOWN', vote: null };
  // Flip to revealed after 1 second
  setTimeout(() => {
    voteCards[agentId] = { state: 'REVEALED', vote };
  }, 1000);
}

export function setBoardroomOutcome(outcome) { outcomeLabel = outcome; }

export function resetBoardroom() {
  voteCards = {
    ARIA:   { state: 'HIDDEN', vote: null },
    KIRAN:  { state: 'HIDDEN', vote: null },
    VIKRAM: { state: 'HIDDEN', vote: null },
  };
  outcomeLabel = null;
  boardroomVisible = false;
}

export function drawBoardroom(ctx) {
  if (!boardroomVisible) return;

  const { x, y, width, height, tableColor } = BOARDROOM;

  // Room background
  ctx.fillStyle = '#1a1a3e';
  ctx.fillRect(x, y, width, height);

  // Room border
  ctx.strokeStyle = '#4a4a8a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);

  // Boardroom label
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('COMMITTEE VOTE', x + width / 2, y + 14);

  // Table
  ctx.fillStyle = tableColor;
  ctx.fillRect(x + 40, y + 40, width - 80, height - 100);
  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 40, y + 40, width - 80, height - 100);

  // Vote cards (placed on table for each voter)
  const cardPositions = [
    { agentId: 'ARIA',   cx: x + 80,  cy: y + 80 },
    { agentId: 'KIRAN',  cx: x + 160, cy: y + 80 },
    { agentId: 'VIKRAM', cx: x + 240, cy: y + 80 },
  ];

  cardPositions.forEach(({ agentId, cx, cy }) => {
    const card = voteCards[agentId];

    if (card.state === 'HIDDEN') return;

    if (card.state === 'FACE_DOWN') {
      // Blue card back
      ctx.fillStyle = '#1565C0';
      ctx.fillRect(cx - 12, cy - 16, 24, 32);
      ctx.strokeStyle = '#90CAF9';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 12, cy - 16, 24, 32);
      // Card back pattern (pixel art X)
      ctx.fillStyle = '#90CAF9';
      ctx.fillRect(cx - 8, cy - 12, 2, 2);
      ctx.fillRect(cx + 6, cy - 12, 2, 2);
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
      ctx.fillRect(cx - 8, cy + 10, 2, 2);
      ctx.fillRect(cx + 6, cy + 10, 2, 2);
    }

    if (card.state === 'REVEALED') {
      const isApprove = card.vote === 'APPROVE';
      ctx.fillStyle = isApprove ? '#1B5E20' : '#B71C1C';
      ctx.fillRect(cx - 12, cy - 16, 24, 32);
      ctx.strokeStyle = isApprove ? '#A5D6A7' : '#EF9A9A';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 12, cy - 16, 24, 32);

      ctx.fillStyle = isApprove ? '#A5D6A7' : '#EF9A9A';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isApprove ? '✓' : '✗', cx, cy - 4);
      ctx.fillText(
        isApprove ? 'APPROVE' : 'REJECT',
        cx, cy + 6
      );
      // Agent name below card
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '8px monospace';
      ctx.fillText(agentId, cx, cy + 24);
    }
  });

  // Reset text baseline
  ctx.textBaseline = 'bottom';

  // Outcome label (center of table)
  if (outcomeLabel) {
    ctx.fillStyle = outcomeLabel === 'APPROVED'
      ? 'rgba(76, 175, 80, 0.9)'
      : 'rgba(244, 67, 54, 0.9)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      outcomeLabel === 'APPROVED' ? '✓ APPROVED' : '✗ DEADLOCKED',
      x + width / 2,
      y + height / 2 + 30
    );
  }
}
