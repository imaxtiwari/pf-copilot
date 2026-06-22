import React, { useRef, useEffect } from 'react';
import { drawOffice, OFFICE_LAYOUT } from './scenes/office.js';

export default function OfficeCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;  // CRITICAL for pixel art

    // Scale canvas to fill window maintaining aspect ratio
    function resize() {
      const scale = Math.min(
        window.innerWidth / OFFICE_LAYOUT.width,
        window.innerHeight / OFFICE_LAYOUT.height
      );
      canvas.style.width = Math.floor(OFFICE_LAYOUT.width * scale) + 'px';
      canvas.style.height = Math.floor(OFFICE_LAYOUT.height * scale) + 'px';
      canvas.width = OFFICE_LAYOUT.width;
      canvas.height = OFFICE_LAYOUT.height;
      ctx.imageSmoothingEnabled = false;

      // Re-draw on resize so the canvas doesn't clear
      drawOffice(ctx, null);
    }

    resize();
    window.addEventListener('resize', resize);

    // Initial draw (static, no animation loop yet)
    drawOffice(ctx, null);  // null tilesheet until sprites loaded

    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        margin: '0 auto',
        imageRendering: 'pixelated',   // CRITICAL — no browser smoothing
      }}
    />
  );
}
