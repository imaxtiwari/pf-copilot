// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

export const OFFICE_LAYOUT = {
  width: 1200,
  height: 800,
  tileSize: 16,
  floor: { color: '#8B7355' },     // warm oak floor
  walls: { color: '#2C2C54' },     // dark navy walls
  accent: { color: '#4A4A8A' },    // slightly lighter accent
};

export const DESK_POSITIONS = {
  RIYA:   { x: 80,  y: 180 },
  VIKRAM: { x: 280, y: 180 },
  SOMA:   { x: 480, y: 180 },
  KIRAN:  { x: 680, y: 180 },
  PRIYA:  { x: 80,  y: 360 },
  ARIA:   { x: 280, y: 360 },
  MENTOR: { x: 80,  y: 520 },
  DHRUV:  { x: 480, y: 600 },
};

export const BOARDROOM = {
  x: 820,
  y: 280,
  width: 320,
  height: 260,
  tableColor: '#5C3D2E',
  chairPositions: [
    { x: 860, y: 320 },   // ARIA
    { x: 920, y: 320 },   // KIRAN
    { x: 980, y: 320 },   // VIKRAM
    { x: 920, y: 480 },   // DHRUV (head of table)
  ]
};

export const PLANTS = [
  { x: 820, y: 180 },
  { x: 160, y: 480 },
  { x: 640, y: 480 },
  { x: 1120, y: 600 },
];

export function drawOffice(ctx, tileSheet, agentManager, state) {
  // CRITICAL: Ensure image smoothing is disabled for pixel art rendering
  ctx.imageSmoothingEnabled = false;

  // 1. Fill floor with warm oak color and draw staggered wood plank pattern
  ctx.fillStyle = OFFICE_LAYOUT.floor.color;
  ctx.fillRect(0, 0, OFFICE_LAYOUT.width, OFFICE_LAYOUT.height);

  ctx.strokeStyle = '#755E43';
  ctx.lineWidth = 1;
  for (let y = 16; y < OFFICE_LAYOUT.height; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(OFFICE_LAYOUT.width, y);
    ctx.stroke();
  }

  for (let y = 0; y < OFFICE_LAYOUT.height; y += 16) {
    const shift = (y / 16) % 2 === 0 ? 0 : 32;
    for (let x = shift; x < OFFICE_LAYOUT.width; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
  }

  // 2. Draw top wall with navy color and windows (Window light pulse & warm yellow patches)
  ctx.fillStyle = OFFICE_LAYOUT.walls.color;
  ctx.fillRect(0, 0, OFFICE_LAYOUT.width, 16);

  const numWindows = 8;
  const windowW = 48;
  const windowH = 12;
  const wallSpacing = OFFICE_LAYOUT.width / (numWindows + 1);
  for (let i = 1; i <= numWindows; i++) {
    const wx = Math.floor(i * wallSpacing - windowW / 2);
    const wy = 2;
    
    // Window glass (blue sky)
    ctx.fillStyle = '#68B0AB';
    ctx.fillRect(wx, wy, windowW, windowH);

    // Glass reflections
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(wx + 10, wy);
    ctx.lineTo(wx + 2, wy + windowH);
    ctx.moveTo(wx + 25, wy);
    ctx.lineTo(wx + 17, wy + windowH);
    ctx.stroke();

    // 5px white frame (drawn as rectangle outline)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, windowW, windowH);

    // Warm yellow light patch below each window (pulsing opacity)
    const lightPulse = 0.6 + Math.sin(Date.now() / 2000) * 0.1;
    ctx.fillStyle = `rgba(255, 235, 59, ${lightPulse * 0.15})`;
    ctx.fillRect(wx - 8, wy + windowH, windowW + 16, 40);
  }

  // Draw Clock on the wall (top-center, 20x20px, white face, dark border)
  const clockX = 600;
  const clockY = 8;
  const clockRadius = 6;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(clockX, clockY, clockRadius, 0, 2 * Math.PI);
  ctx.fill();

  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(clockX, clockY, clockRadius, 0, 2 * Math.PI);
  ctx.stroke();

  // Minute hand updates in real time using Date.now()
  const minutesAngle = ((Date.now() / 60000) % 60) * (360 / 60) * (Math.PI / 180) - Math.PI / 2;
  ctx.strokeStyle = '#2C2C54';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(clockX, clockY);
  ctx.lineTo(clockX + Math.cos(minutesAngle) * 4, clockY + Math.sin(minutesAngle) * 4);
  ctx.stroke();

  // 3. Draw bottom wall with navy color and bookshelf tiles
  ctx.fillStyle = OFFICE_LAYOUT.walls.color;
  ctx.fillRect(0, 784, OFFICE_LAYOUT.width, 16);

  const bookshelfXStart = 100;
  const bookshelfY = 752;
  const bookshelfW = 48;
  const bookshelfH = 32;
  for (let i = 0; i < 3; i++) {
    const bx = bookshelfXStart + i * (bookshelfW + 8);
    // Wood backplate
    ctx.fillStyle = '#5C3D2E';
    ctx.fillRect(bx, bookshelfY, bookshelfW, bookshelfH);
    
    // Shelves
    ctx.fillStyle = '#3E2723';
    ctx.fillRect(bx + 2, bookshelfY + 10, bookshelfW - 4, 2);
    ctx.fillRect(bx + 2, bookshelfY + 20, bookshelfW - 4, 2);

    // Dynamic books representation (seeded colors for consistency)
    const bookColors = ['#D32F2F', '#1976D2', '#388E3C', '#FBC02D', '#7B1FA2'];
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = bookshelfY + shelf * 10 + 2;
      let bx_offset = 4;
      while (bx_offset < bookshelfW - 8) {
        const bookW = ((bx_offset + shelf) % 3) + 2;
        const bookH = ((bx_offset * 7 + shelf) % 4) + 4;
        ctx.fillStyle = bookColors[(bx_offset + shelf) % bookColors.length];
        ctx.fillRect(bx + bx_offset, sy + (8 - bookH), bookW, bookH);
        bx_offset += bookW + 1;
      }
    }

    // Bookshelf outline
    ctx.strokeStyle = '#2A1B15';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, bookshelfY, bookshelfW, bookshelfH);
  }

  // 4. Draw door (bottom-right area)
  const doorX = 1000;
  const doorY = 752;
  const doorW = 32;
  const doorH = 32;
  ctx.fillStyle = '#3E2723';
  ctx.fillRect(doorX, doorY, doorW, doorH);
  ctx.fillStyle = '#8B5A2B';
  ctx.fillRect(doorX + 2, doorY, doorW - 4, doorH);
  ctx.fillStyle = '#FFD700'; // Gold door knob
  ctx.fillRect(doorX + doorW - 8, doorY + 16, 3, 3);

  // 5. Draw each desk at DESK_POSITIONS
  Object.entries(DESK_POSITIONS).forEach(([agentId, pos]) => {
    const isDhruv = agentId === 'DHRUV';
    const deskW = isDhruv ? 72 : 48;
    const deskH = 24;

    // Draw DHRUV's desk gold glow during active pipeline
    if (isDhruv && state && state.dhruvGlow > 0) {
      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = Math.floor(8 * state.dhruvGlow);
      ctx.strokeStyle = `rgba(255, 215, 0, ${state.dhruvGlow})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x - 2, pos.y - 2, deskW + 4, deskH + 4);
      ctx.restore();
    }

    // Draw chair below the desk (top-down RPG perspective)
    const chairW = 16;
    const chairH = 16;
    const chairX = pos.x + (deskW - chairW) / 2;
    const chairY = pos.y + deskH + 4;

    ctx.fillStyle = '#1A1A1A'; // Black office chair
    ctx.fillRect(chairX, chairY, chairW, chairH);
    ctx.fillStyle = '#333333';
    ctx.fillRect(chairX - 2, chairY + 2, 2, chairH - 4);
    ctx.fillRect(chairX + chairW, chairY + 2, 2, chairH - 4);

    // Draw desk (dark wood rectangle)
    ctx.fillStyle = '#4A2E1B';
    ctx.fillRect(pos.x, pos.y, deskW, deskH);

    // Draw desk drawer highlights
    ctx.fillStyle = '#2E1C10';
    ctx.fillRect(pos.x + 2, pos.y + deskH - 6, 12, 4);
    if (isDhruv) {
      ctx.fillRect(pos.x + deskW - 14, pos.y + deskH - 6, 12, 4);
    }

    ctx.strokeStyle = '#1E110A';
    ctx.lineWidth = 1;
    ctx.strokeRect(pos.x, pos.y, deskW, deskH);

    // Special item: ARIA's red string pinboard to the right
    if (agentId === 'ARIA') {
      const pinboardX = pos.x + deskW + 8;
      const pinboardY = pos.y - 4;
      const pinboardW = 16;
      const pinboardH = 24;
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(pinboardX, pinboardY, pinboardW, pinboardH);
      ctx.fillStyle = '#C84B31';
      ctx.fillRect(pinboardX + 2, pinboardY + 2, pinboardW - 4, pinboardH - 4);
      // Small papers and string details
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(pinboardX + 4, pinboardY + 4, 3, 4);
      ctx.fillRect(pinboardX + 9, pinboardY + 12, 3, 4);
      ctx.strokeStyle = '#D32F2F'; // Red string
      ctx.beginPath();
      ctx.moveTo(pinboardX + 5, pinboardY + 6);
      ctx.lineTo(pinboardX + 10, pinboardY + 14);
      ctx.stroke();

      // Blinking red dot representing active fault detection (every 800ms)
      if (Math.floor(Date.now() / 800) % 2 === 0) {
        ctx.fillStyle = '#FF1744';
        ctx.fillRect(pinboardX + 11, pinboardY + 5, 2, 2);
      }
    }

    // Special item: MENTOR's bookshelf behind desk
    if (agentId === 'MENTOR') {
      const mentorBookshelfX = pos.x;
      const mentorBookshelfY = pos.y - 28;
      const mentorBookshelfW = 48;
      const mentorBookshelfH = 24;

      ctx.fillStyle = '#5C3D2E';
      ctx.fillRect(mentorBookshelfX, mentorBookshelfY, mentorBookshelfW, mentorBookshelfH);
      ctx.fillStyle = '#3E2723';
      ctx.fillRect(mentorBookshelfX + 2, mentorBookshelfY + 8, mentorBookshelfW - 4, 2);
      ctx.fillRect(mentorBookshelfX + 2, mentorBookshelfY + 16, mentorBookshelfW - 4, 2);

      const bookColors = ['#D32F2F', '#1976D2', '#388E3C', '#FBC02D'];
      for (let shelf = 0; shelf < 2; shelf++) {
        const sy = mentorBookshelfY + shelf * 8 + 2;
        let bx_offset = 4;
        while (bx_offset < mentorBookshelfW - 6) {
          const bookW = ((bx_offset + shelf) % 2) + 2;
          const bookH = ((bx_offset * 3 + shelf) % 3) + 3;
          ctx.fillStyle = bookColors[(bx_offset + shelf) % bookColors.length];
          ctx.fillRect(mentorBookshelfX + bx_offset, sy + (6 - bookH), bookW, bookH);
          bx_offset += bookW + 1;
        }
      }
      ctx.strokeStyle = '#2A1B15';
      ctx.lineWidth = 1;
      ctx.strokeRect(mentorBookshelfX, mentorBookshelfY, mentorBookshelfW, mentorBookshelfH);
    }
  });

  // 6. Draw Boardroom
  // Semi-transparent partition walls and custom background color tint
  ctx.fillStyle = 'rgba(74, 74, 138, 0.12)';
  ctx.fillRect(BOARDROOM.x, BOARDROOM.y, BOARDROOM.width, BOARDROOM.height);
  ctx.strokeStyle = 'rgba(74, 74, 138, 0.6)';
  ctx.lineWidth = 4;
  ctx.strokeRect(BOARDROOM.x, BOARDROOM.y, BOARDROOM.width, BOARDROOM.height);

  // Boardroom Table
  const tableW = 200;
  const tableH = 100;
  const tableX = BOARDROOM.x + (BOARDROOM.width - tableW) / 2;
  const tableY = BOARDROOM.y + (BOARDROOM.height - tableH) / 2;
  ctx.fillStyle = BOARDROOM.tableColor;
  ctx.fillRect(tableX, tableY, tableW, tableH);
  ctx.strokeStyle = '#3E2723';
  ctx.lineWidth = 2;
  ctx.strokeRect(tableX, tableY, tableW, tableH);

  // Boardroom Chairs
  BOARDROOM.chairPositions.forEach((pos) => {
    const chairW = 16;
    const chairH = 16;
    const cx = pos.x - chairW / 2;
    const cy = pos.y - chairH / 2;
    ctx.fillStyle = '#8B5A2B'; // Leather brown chairs
    ctx.fillRect(cx, cy, chairW, chairH);
    ctx.strokeStyle = '#5E3511';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, chairW, chairH);
  });

  // 7. Draw Plants with swaying motion
  PLANTS.forEach((pos, plantIndex) => {
    // Terracotta pot
    const potW = 12;
    const potH = 10;
    const potX = pos.x - potW / 2;
    const potY = pos.y + 4;
    ctx.fillStyle = '#CD7F32';
    ctx.fillRect(potX, potY, potW, potH);
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 1;
    ctx.strokeRect(potX, potY, potW, potH);

    // Swaying leaves
    const sway = Math.sin(Date.now() / 1200 + plantIndex) * 1.5;
    ctx.fillStyle = '#2E7D32';
    ctx.fillRect(Math.floor(pos.x - 8 + sway), pos.y - 8, 16, 12);
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(Math.floor(pos.x - 5 + sway), pos.y - 5, 10, 8);
  });

  // 8. Draw Water Cooler near MENTOR's desk area
  const coolerX = 180;
  const coolerY = 520;
  ctx.fillStyle = '#B0BEC5'; // Silver stand
  ctx.fillRect(coolerX, coolerY + 12, 12, 16);
  ctx.strokeStyle = '#78909C';
  ctx.lineWidth = 1;
  ctx.strokeRect(coolerX, coolerY + 12, 12, 16);
  ctx.fillStyle = '#0288D1'; // Blue water tank
  ctx.fillRect(coolerX + 1, coolerY, 10, 12);
  ctx.fillStyle = '#29B6F6'; // Water shine reflection
  ctx.fillRect(coolerX + 3, coolerY + 2, 4, 8);

  // 9. Draw agent name labels and status dots above desks
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  Object.entries(DESK_POSITIONS).forEach(([agentId, pos]) => {
    const isDhruv = agentId === 'DHRUV';
    const deskW = isDhruv ? 72 : 48;
    const labelX = pos.x + deskW / 2;
    const labelY = pos.y - 4;

    // Set ctx.font strictly before drawing text (monospace only)
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(agentId, labelX, labelY);

    // Get current state of agent if agentManager is available
    const agent = agentManager ? agentManager.get(agentId) : null;
    const stateVal = agent ? agent.state : 'IDLE';

    // Status dot (above label)
    const dotX = labelX;
    const dotY = labelY - 12;
    let dotColor = '#546e7a'; // IDLE grey
    let dotSize = 4;

    if (stateVal === 'ACTIVE') {
      dotColor = '#4fc3f7';
      const pulseScale = 1 + Math.sin(Date.now() / 300) * 0.3;
      dotSize = Math.floor(4 * pulseScale);
    } else if (stateVal === 'WALKING') {
      dotColor = '#ffb300';
    } else if (stateVal === 'VOTING') {
      dotColor = '#9c27b0';
    }

    ctx.fillStyle = dotColor;
    ctx.fillRect(Math.floor(dotX - dotSize / 2), Math.floor(dotY - dotSize / 2), dotSize, dotSize);
  });
}
