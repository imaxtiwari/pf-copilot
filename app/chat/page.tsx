'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'

import type { WorkspaceState, AgentEvent, CopilotStatus } from '@/lib/contracts/agent-events'
import { buildWorkspaceState } from '@/lib/agent-mapping'
import { AIWorkspaceShell } from '@/components/ai-workspace-shell'
import { AgentActivityPanel } from '@/components/agent-activity-panel'
import type { ToolTrace } from '@/lib/orchestrator'
import { subscribeToChatStream, type ChatStreamData } from '@/lib/sse-client'
import { isStale } from '@/lib/freshness'

// ── types ─────────────────────────────────────────────────────────────────────

type Citation = {
  chunk_id: string
  section: string
  factsheet_date: string
}

export type ChatApiData = {
  assistant_message: string
  tool_traces: ToolTrace[]
  citations: Citation[]
  model_version: string
  refusal_reason: string | null
  request_id: string
  workspace_state?: WorkspaceState
}

export type SupportedLanguage = 'en' | 'hi-en'

type Message = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  ts?: string
}

type ChatResponse = {
  ok: boolean
  data?: ChatApiData
  error?: { message: string }
}

const INTENT_KEYWORDS = ['portfolio', 'inflation', 'fund', 'stock', 'compare']

// ── sub-components ─────────────────────────────────────────────────────────────

function CitationChip({ citation }: { citation: Citation }) {
  const stale = isStale({ lastSyncedAt: citation.factsheet_date, freshnessDays: 7, isStale: false })
  return (
    <span
      title={`${citation.section} · ${citation.factsheet_date}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${stale
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-indigo-200 bg-indigo-50 text-indigo-700'
        }`}
    >
      <span className="font-mono">{citation.chunk_id}</span>
      <span className={stale ? 'text-amber-400' : 'text-indigo-400'}>·</span>
      <span>{citation.section}</span>
      {stale && <span>⚠</span>}
    </span>
  )
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const hasStaleCitations =
    !isUser &&
    message.citations &&
    message.citations.some((c) => isStale({ lastSyncedAt: c.factsheet_date, freshnessDays: 7, isStale: false }))
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

        {/* Freshness warning */}
        {hasStaleCitations && (
          <p className="mt-2 text-xs text-amber-600">
            ⚠ Some cited factsheets are older than 7 days.
          </p>
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

function detectIntent(text: string): string | null {
  const lower = text.toLowerCase()
  for (const keyword of INTENT_KEYWORDS) {
    if (lower.includes(keyword)) return keyword
  }
  return null
}

function buildQueuedState(intent: string | null): WorkspaceState {
  const agents: WorkspaceState['agents'] = [
    { name: 'Portfolio Analyst', status: 'queued', currentTask: 'Queued for portfolio analysis', evidence: [], nextStep: 'Will activate if needed' },
    { name: 'Inflation Analyst', status: 'queued', currentTask: 'Queued for inflation analysis', evidence: [], nextStep: 'Will activate if needed' },
    { name: 'Performance Analyst', status: 'queued', currentTask: 'Queued for return analysis', evidence: [], nextStep: 'Will activate if needed' },
    { name: 'Fund Research Agent', status: 'queued', currentTask: 'Queued for fund research', evidence: [], nextStep: 'Will activate if needed' },
    { name: 'Risk Analyst', status: 'queued', currentTask: 'Queued for risk review', evidence: [], nextStep: 'Will activate if needed' },
    { name: 'Copilot', status: 'working', currentTask: 'Understanding your question and routing to analysts', evidence: [], nextStep: 'Deliver final answer' },
  ]

  // Mark relevant agents as queued based on the detected intent.  If no intent
  // is detected, everything remains queued so the panel still shows activity.
  const relevant = new Set<string>()
  if (intent === 'portfolio') {
    relevant.add('Portfolio Analyst')
    relevant.add('Performance Analyst')
  } else if (intent === 'inflation') {
    relevant.add('Inflation Analyst')
    relevant.add('Performance Analyst')
  } else if (intent === 'fund') {
    relevant.add('Fund Research Agent')
  } else if (intent === 'stock') {
    relevant.add('Risk Analyst')
  } else if (intent === 'compare') {
    relevant.add('Fund Research Agent')
    relevant.add('Risk Analyst')
  }

  const updatedAgents = agents.map((agent) => {
    if (agent.name === 'Copilot') return agent
    if (relevant.size > 0 && !relevant.has(agent.name)) {
      return { ...agent, status: 'idle' as const, currentTask: 'Standing by' }
    }
    return agent
  })

  return {
    copilotStatus: 'analysing',
    agents: updatedAgents,
    activity: [
      {
        id: 'copilot-queued',
        timestamp: new Date(),
        agent: 'Copilot',
        message: `Analysing your question${intent ? ` about ${intent}` : ''}`,
      },
    ],
    summary: 'Your financial team · Preparing analysis',
  }
}

function buildCompleteState(assistantMessage: string): WorkspaceState {
  return {
    copilotStatus: 'complete',
    agents: [
      { name: 'Portfolio Analyst', status: 'idle', currentTask: 'Standing by', evidence: [], nextStep: 'Will activate if needed' },
      { name: 'Inflation Analyst', status: 'idle', currentTask: 'Standing by', evidence: [], nextStep: 'Will activate if needed' },
      { name: 'Performance Analyst', status: 'idle', currentTask: 'Standing by', evidence: [], nextStep: 'Will activate if needed' },
      { name: 'Fund Research Agent', status: 'idle', currentTask: 'Standing by', evidence: [], nextStep: 'Will activate if needed' },
      { name: 'Risk Analyst', status: 'idle', currentTask: 'Standing by', evidence: [], nextStep: 'Will activate if needed' },
      { name: 'Copilot', status: 'complete', currentTask: 'Synthesis complete', evidence: [{ label: 'Response length', value: `${assistantMessage.length} chars` }], nextStep: 'Deliver final answer' },
    ],
    activity: [
      {
        id: 'copilot-complete',
        timestamp: new Date(),
        agent: 'Copilot',
        message: 'Copilot synthesised the final response',
        evidence: [{ label: 'Response length', value: `${assistantMessage.length} chars` }],
      },
    ],
    summary: 'Your financial team · Analysis complete',
  }
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [language, setLanguage] = useState<SupportedLanguage>('en')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null)
  const [panelExpanded, setPanelExpanded] = useState(true)
  const [streamedEvents, setStreamedEvents] = useState<AgentEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const streamCloseRef = useRef<(() => void) | null>(null)

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
    setStreaming(true)
    setStreamedEvents([])
    setWorkspaceState(buildQueuedState(detectIntent(text)))

    const closeStream = subscribeToChatStream(
      '/api/chat/stream',
      { message: text, language },
      {
        onEvent: (event) => {
          setStreamedEvents((prev) => [...prev, event])
        },
        onStatusChange: (status: CopilotStatus) => {
          setWorkspaceState((prev) =>
            prev
              ? {
                ...prev,
                copilotStatus: status,
              }
              : prev,
          )
        },
        onComplete: (data: ChatStreamData) => {
          const { assistant_message, tool_traces, citations, workspace_state } = data
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: assistant_message,
              citations,
              id: data.request_id,
            },
          ])

          if (workspace_state) {
            setWorkspaceState(workspace_state)
          } else if (tool_traces && tool_traces.length > 0) {
            setWorkspaceState(buildWorkspaceState(tool_traces, assistant_message, true))
          } else {
            setWorkspaceState(buildCompleteState(assistant_message))
          }

          setLoading(false)
          setStreaming(false)
          streamCloseRef.current = null
          inputRef.current?.focus()
        },
        onError: (error) => {
          const fallback = error.message ?? 'Something went wrong. Please try again.'
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: fallback },
          ])
          setWorkspaceState(buildCompleteState(fallback))
          setLoading(false)
          setStreaming(false)
          streamCloseRef.current = null
          inputRef.current?.focus()
        },
      },
    )

    streamCloseRef.current = closeStream
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

  const chatThread = (
    <>
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
                &ldquo;What's my real return on Parag Parikh Flexi?&rdquo;, or
                &ldquo;Explain the expense ratio of HDFC Top 100.&rdquo;
              </p>
              <p className="mt-1 rounded bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
                I explain. I don't advise. Always verify with your financial advisor.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={msg.id ?? i} message={msg} />
          ))}

          {loading && <TypingIndicator />}

          {streaming && streamedEvents.length > 0 && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl bg-white px-4 py-3 text-xs text-gray-500 shadow-sm ring-1 ring-gray-100">
                <p className="font-medium text-indigo-700">Analyst activity</p>
                <ul className="mt-1 space-y-0.5">
                  {streamedEvents.slice(-5).map((ev, i) => (
                    <li key={`${('id' in ev ? ev.id : i) ?? i}-${i}`}>
                      {'agent' in ev ? ev.agent : 'Copilot'}: {ev.type.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
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
    </>
  )

  return (
    <AIWorkspaceShell
      panel={
        workspaceState ? (
          <AgentActivityPanel
            state={workspaceState}
            expanded={panelExpanded}
            onToggleExpand={() => setPanelExpanded((p) => !p)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-950">
            <div className="text-3xl">🤖</div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Your AI team is standing by
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Send a message to start the analysis.
              </p>
            </div>
          </div>
        )
      }
    >
      {chatThread}
    </AIWorkspaceShell>
  )
}
