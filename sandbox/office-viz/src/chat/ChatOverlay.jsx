// TODO: implement in Phase {N}
// Part of: pf-copilot office visualization sandbox

import React, { useState, useRef, useEffect } from 'react';

const STYLES = {
  toggle: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '48px',
    height: '48px',
    background: '#1e3a5f',
    border: '2px solid #4fc3f7',
    color: '#4fc3f7',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    imageRendering: 'pixelated',
    boxShadow: '0 0 12px rgba(79, 195, 247, 0.4)',
  },
  container: {
    position: 'fixed',
    bottom: '80px',
    right: '24px',
    width: '340px',
    height: '460px',
    background: '#0d1b2a',
    border: '2px solid #4fc3f7',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
    fontFamily: 'monospace',
    boxShadow: '0 0 24px rgba(79, 195, 247, 0.3)',
  },
  header: {
    padding: '8px 12px',
    background: '#1e3a5f',
    borderBottom: '1px solid #4fc3f7',
    color: '#4fc3f7',
    fontSize: '11px',
    letterSpacing: '2px',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  userMsg: {
    alignSelf: 'flex-end',
    background: '#1e3a5f',
    border: '1px solid #4fc3f7',
    color: '#e3f2fd',
    padding: '6px 10px',
    fontSize: '11px',
    maxWidth: '80%',
    lineHeight: '1.5',
  },
  assistantMsg: {
    alignSelf: 'flex-start',
    background: '#0a1628',
    border: '1px solid #2c3e50',
    color: '#b0bec5',
    padding: '6px 10px',
    fontSize: '11px',
    maxWidth: '85%',
    lineHeight: '1.5',
  },
  inputRow: {
    display: 'flex',
    borderTop: '1px solid #4fc3f7',
  },
  input: {
    flex: 1,
    background: '#0d1b2a',
    border: 'none',
    color: '#e3f2fd',
    padding: '8px 10px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  sendBtn: {
    background: '#1e3a5f',
    border: 'none',
    borderLeft: '1px solid #4fc3f7',
    color: '#4fc3f7',
    padding: '0 14px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  thinking: {
    alignSelf: 'flex-start',
    color: '#546e7a',
    fontSize: '11px',
    padding: '4px 10px',
  }
};

export default function ChatOverlay() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Intelligence floor online. Ask me anything about the pipeline, agents, or your portfolio.'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-10)  // last 10 messages as context
        })
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message || data.content || 'No response received.'
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}. Is the pf-copilot server running on port 3000?`
      }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <button style={STYLES.toggle} onClick={() => setOpen(o => !o)}>
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div style={STYLES.container}>
          <div style={STYLES.header}>
            ▸ INTELLIGENCE FLOOR CHAT
          </div>
          <div style={STYLES.messages}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={m.role === 'user' ? STYLES.userMsg : STYLES.assistantMsg}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={STYLES.thinking}>▸ thinking...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div style={STYLES.inputRow}>
            <input
              style={STYLES.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="ask anything..."
              disabled={loading}
            />
            <button style={STYLES.sendBtn} onClick={send} disabled={loading}>
              ▸
            </button>
          </div>
        </div>
      )}
    </>
  );
}
