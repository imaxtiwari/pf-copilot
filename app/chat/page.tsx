'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'

// ── types ─────────────────────────────────────────────────────────────────────

type Citation = {
  chunk_id: string
  section: string
  factsheet_date: string
}

export type SupportedLanguage = 'en' | 'hi-en'

type Message = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  ts?: string
}

// ── sub-components ─────────────────────────────────────────────────────────────

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <span
      title={`${citation.section} · ${citation.factsheet_date}`}
      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
    >
      <span className="font-mono">{citation.chunk_id}</span>
      <span className="text-indigo-400">·</span>
      <span>{citation.section}</span>
    </span>
  )
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${isUser
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-100'
          }`}
      >
        {/* Content — preserve whitespace */}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

        {/* Citation chips */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <CitationChip key={c.chunk_id} citation={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  )
}

function detectDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text)
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [language, setLanguage] = useState<SupportedLanguage>('en')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch('/api/chat')
        const json = (await res.json()) as { ok: boolean; data?: { messages: Message[] } }
        if (json.ok && json.data?.messages) {
          setMessages(json.data.messages)
        }
      } catch {
        // silently ignore — history unavailable
      } finally {
        setHistoryLoaded(true)
      }
    }
    void loadHistory()
  }, [])

  // Auto-detect language from user input
  useEffect(() => {
    if (input.trim().length > 0) {
      const detected = detectDevanagari(input) ? 'hi-en' : 'en'
      if (detected !== language) setLanguage(detected)
    }
  }, [input, language])

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    const userMsg: Message = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, language }),
      })
      const json = (await res.json()) as {
        ok: boolean
        data?: { assistant_message: string; citations: Citation[] }
        error?: { message: string }
      }

      if (json.ok && json.data) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: json.data!.assistant_message,
            citations: json.data!.citations,
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: json.error?.message ?? 'Something went wrong. Please try again.',
          },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Network error. Please check your connection and try again.' },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // Auto-grow textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
  }

  // Submit on Enter (Shift+Enter = newline)
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(e as unknown as FormEvent)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-base font-semibold text-gray-900">PF Copilot</h1>
          <p className="text-xs text-gray-500">Educational only · Not investment advice</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${language === 'en'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLanguage('hi-en')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${language === 'hi-en'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              हिंदी
            </button>
          </div>
          <a
            href="/chat/audit"
            className="text-xs text-indigo-600 underline-offset-2 hover:underline"
          >
            Audit log
          </a>
          <a
            href="/onboarding"
            className="text-xs text-indigo-600 underline-offset-2 hover:underline"
          >
            Edit profile
          </a>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {/* Empty state */}
          {historyLoaded && messages.length === 0 && (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <div className="text-3xl">💰</div>
              <h2 className="text-lg font-semibold text-gray-800">
                Ask me about your portfolio
              </h2>
              <p className="max-w-sm text-sm text-gray-500">
                Try: &ldquo;What does my portfolio look like?&rdquo;,
                &ldquo;What&apos;s my real return on Parag Parikh Flexi?&rdquo;, or
                &ldquo;Explain the expense ratio of HDFC Top 100.&rdquo;
              </p>
              <p className="mt-1 rounded bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
                I explain. I don&apos;t advise. Always verify with your financial advisor.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={msg.id ?? i} message={msg} />
          ))}

          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="border-t border-gray-200 bg-white px-4 py-3">
        <form
          onSubmit={(e) => void sendMessage(e)}
          className="mx-auto flex max-w-2xl items-end gap-2"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your portfolio…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
            aria-label="Send"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </form>
        <p className="mt-1.5 text-center text-xs text-gray-400">
          Educational only · Not financial advice · Verify with your advisor
        </p>
      </footer>
    </div>
  )
}
