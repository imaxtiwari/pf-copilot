// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from './renderer.js';
import { MockPlayer } from '../events/MockPlayer.js';
import { SSEClient } from '../events/SSEClient.js';
import { eventBus } from '../events/EventBus.js';
import mockEvents from '../assets/mock-events.json';

export default function OfficeCanvas() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const playerRef = useRef(null);
  const sseRef = useRef(null);
  const [mode, setMode] = useState('DETECTING');
  // DETECTING | LIVE | PLAYBACK | IDLE

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    function resize() {
      const scale = Math.min(
        window.innerWidth / 1200,
        window.innerHeight / 800
      );
      canvas.style.width  = Math.floor(1200 * scale) + 'px';
      canvas.style.height = Math.floor(800 * scale) + 'px';
      canvas.width  = 1200;
      canvas.height = 800;
      canvas.getContext('2d').imageSmoothingEnabled = false;
    }

    resize();
    window.addEventListener('resize', resize);

    renderer.loadAssets().then(() => renderer.start());

    // Try SSE first
    const sse = new SSEClient('/api/pipeline/events');
    sseRef.current = sse;

    const unsubConnected = eventBus.on('SSE_CONNECTED', () => setMode('LIVE'));

    const unsubError = eventBus.on('SSE_ERROR', () => {
      // SSE failed — fall back to playback
      setMode('PLAYBACK');
      if (!playerRef.current) {
        const player = new MockPlayer(mockEvents.events);
        playerRef.current = player;
        player.play(1);
      }
    });

    const unsubSwitch = eventBus.on('SWITCH_TO_MOCK', () => {
      setMode('PLAYBACK');
      if (!playerRef.current) {
        const player = new MockPlayer(mockEvents.events);
        playerRef.current = player;
        player.play(1);
      }
    });

    const unsubComplete = eventBus.on('PLAYBACK_COMPLETE', () => {
      setMode('IDLE');
    });

    // Attempt SSE connection (5 second timeout)
    setMode('DETECTING');
    const timeout = setTimeout(() => {
      // If we are still trying to detect after 5s, trigger fallback to Mock mode
      eventBus.emit('SSE_ERROR', {});
    }, 5000);

    sse.connect();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', resize);
      renderer.stop();
      sse.disconnect();
      if (playerRef.current) {
        playerRef.current.pause();
      }
      unsubConnected();
      unsubError();
      unsubSwitch();
      unsubComplete();
    };
  }, []);

  const modeColors = {
    DETECTING: '#ffb300',
    LIVE:      '#66bb6a',
    PLAYBACK:  '#4fc3f7',
    IDLE:      '#546e7a',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'pixelated' }}
      />

      {/* Mode indicator — top-left corner */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: 'rgba(0,0,0,0.7)',
        border: `1px solid ${modeColors[mode]}`,
        color: modeColors[mode],
        fontFamily: 'monospace', fontSize: '10px',
        padding: '3px 8px', letterSpacing: '1px',
      }}>
        ▸ {mode}
      </div>

      {/* Playback controls — bottom-center, only in PLAYBACK/IDLE mode */}
      {(mode === 'PLAYBACK' || mode === 'IDLE') && (
        <div style={{
          position: 'absolute', bottom: 8,
          left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '8px',
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid #4fc3f7',
          padding: '4px 12px',
        }}>
          {['0.5×', '1×', '2×'].map(speed => (
            <button key={speed}
              onClick={() => playerRef.current?.play(parseFloat(speed))}
              style={{
                background: 'none', border: 'none',
                color: '#4fc3f7', fontFamily: 'monospace',
                fontSize: '10px', cursor: 'pointer',
              }}>
              {speed}
            </button>
          ))}
          <button
            onClick={() => {
              if (playerRef.current) {
                playerRef.current.reset();
                playerRef.current.play(1);
              }
              setMode('PLAYBACK');
            }}
            style={{
              background: 'none', border: 'none',
              color: '#4fc3f7', fontFamily: 'monospace',
              fontSize: '10px', cursor: 'pointer',
            }}>
            ↺ replay
          </button>
        </div>
      )}
    </div>
  );
}
