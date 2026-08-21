// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

const BUBBLE_COLORS = {
  THINKING: { bg: '#1e3a5f', border: '#4fc3f7', text: '#e3f2fd' },
  WARN:     { bg: '#3e2a00', border: '#ffb300', text: '#fff8e1' },
  FAULT:    { bg: '#3e0000', border: '#ef5350', text: '#ffebee' },
  SUCCESS:  { bg: '#003e1f', border: '#66bb6a', text: '#e8f5e9' },
};

export class ThoughtBubble {
  constructor() {
    this.fullText = '';        // complete text to display
    this.displayedChars = 0;  // chars currently shown (streaming)
    this.charTimer = 0;       // ms since last char added
    this.charDelay = 30;      // ms per character (typing speed)
    this.visible = true;
    this.fadeAlpha = 1;
    this.fading = false;
    this.fadeTimer = 0;
    this.fadeDuration = 800;
    this.type = 'THINKING';   // THINKING | WARN | FAULT | SUCCESS
    this.maxWidth = 220;      // max bubble width in px
    this.lineHeight = 12;
    this.padding = 8;
    this.fontSize = 9;
  }

  setText(text, append = false) {
    if (append) {
      this.fullText += text;
    } else {
      this.fullText = text;
      this.displayedChars = 0;
    }
    this.fading = false;
    this.fadeAlpha = 1;
    this.visible = true;
  }

  setType(type) {
    this.type = type;
  }

  startFade() {
    this.fading = true;
    this.fadeTimer = 0;
  }

  update(deltaMs) {
    // Stream text character by character
    if (this.displayedChars < this.fullText.length) {
      this.charTimer += deltaMs;
      const charsToAdd = Math.floor(this.charTimer / this.charDelay);
      if (charsToAdd > 0) {
        this.displayedChars = Math.min(
          this.displayedChars + charsToAdd,
          this.fullText.length
        );
        this.charTimer = this.charTimer % this.charDelay;
      }
    }

    // Fade out
    if (this.fading) {
      this.fadeTimer += deltaMs;
      this.fadeAlpha = 1 - (this.fadeTimer / this.fadeDuration);
      if (this.fadeAlpha <= 0) {
        this.visible = false;
        this.fadeAlpha = 0;
      }
    }
  }

  draw(ctx, x, y) {
    if (!this.visible) return;

    const colors = BUBBLE_COLORS[this.type];
    const text = this.fullText.slice(0, this.displayedChars);

    ctx.save();
    ctx.globalAlpha = this.fadeAlpha;
    ctx.font = `${this.fontSize}px monospace`;

    // Word wrap the text
    const lines = this.wrapText(ctx, text, this.maxWidth - this.padding * 2);
    const bubbleW = this.maxWidth;
    const bubbleH = lines.length * this.lineHeight + this.padding * 2 + 8;

    // Position bubble above agent, centered
    const bx = Math.floor(x - bubbleW / 2 + 16);
    const by = Math.floor(y - bubbleH - 12);

    // Draw bubble background
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    this.drawRoundRect(ctx, bx, by, bubbleW, bubbleH, 4);
    ctx.fill();
    ctx.stroke();

    // Draw bubble tail (small triangle pointing down to agent)
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.moveTo(bx + bubbleW / 2 - 5, by + bubbleH);
    ctx.lineTo(bx + bubbleW / 2 + 5, by + bubbleH);
    ctx.lineTo(bx + bubbleW / 2, by + bubbleH + 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colors.border;
    ctx.stroke();

    // Draw text lines
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillText(
        line,
        bx + this.padding,
        by + this.padding + (i + 1) * this.lineHeight
      );
    });

    // Blinking cursor if still streaming
    if (this.displayedChars < this.fullText.length) {
      const lastLine = lines[lines.length - 1] || '';
      const cursorX = bx + this.padding +
        ctx.measureText(lastLine).width + 2;
      const cursorY = by + this.padding +
        lines.length * this.lineHeight - 2;
      if (Math.floor(Date.now() / 400) % 2 === 0) {
        ctx.fillStyle = colors.border;
        ctx.fillRect(cursorX, cursorY - 8, 1, 10);
      }
    }

    ctx.restore();
  }

  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    // Cap at 5 lines — show most recent
    return lines.slice(-5);
  }

  drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
