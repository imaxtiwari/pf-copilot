/**
 * PF Copilot eval runner.
 * Run: npm run eval
 *
 * Requires: npm run eval:setup (generates golden CAS PDFs)
 *
 * Exit codes:
 *   0 — all gates pass
 *   1 — bait/refusal pass rate < 100% OR factual/flow pass rate < 80%
 */

import * as fs from 'fs'
import * as path from 'path'

// ── env is loaded via --env-file=.env.local (Node ≥ 20.6) ──────────────────
// Modules that use lib/db.ts will find DATABASE_URL set in process.env.

import { EXPLAIN_FUND_CASES } from './explain-fund.eval'
import { ORCHESTRATOR_CASES } from './orchestrator.eval'
import { EXPLAIN_FUND_PROMPT } from '../../lib/prompts/explain-fund'
import { ORCHESTRATOR_PROMPT } from '../../lib/prompts/orchestrator'
import { explainFund } from '../../lib/rag/explain-fund'
import { runOrchestrator } from '../../lib/orchestrator'
import type { EvalCase } from './explain-fund.eval'
import type { OrchestratorEvalCase } from './orchestrator.eval'
import type { RagResponseFormatted } from '../../lib/contracts/refusal-types'

// DB for eval setup / teardown (contradiction injection, eval user)
import { eq } from 'drizzle-orm'
import { db } from '../../lib/db'
import * as schema from '../../db/schema'

// ── types ─────────────────────────────────────────────────────────────────────

type RagCaseResult = {
  name: string
  category: EvalCase['category']
  passed: boolean
  failures: string[]
  refused: boolean
  citations_count: number
}

type OrchestratorCaseResult = {
  name: string
  category: OrchestratorEvalCase['category']
  passed: boolean
  failures: string[]
  tools_called: string[]
}

type GoldenCasResult = {
  name: string
  passed: boolean
  failures: string[]
  holdings_extracted: number
  total_value_extracted: number | null
}

type EvalReport = {
  timestamp: string
  model_deployment: string | undefined
  explain_fund_prompt_version: string
  orchestrator_prompt_version: string
  rag_cases: RagCaseResult[]
  orchestrator_cases: OrchestratorCaseResult[]
  golden_cas_cases: GoldenCasResult[]
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Strip <user_question>...</user_question> from answer before checking words. */
function stripUserQuestion(text: string): string {
  return text.replace(/<user_question>[\s\S]*?<\/user_question>/g, '')
}

// ── RAG eval ──────────────────────────────────────────────────────────────────

const CONTRA_SCHEME = 'EVAL_CONTRA_9999'

async function setupContradiction(): Promise<void> {
  // Ensure scheme exists in amfi_scheme_master
  await db
    .insert(schema.amfiSchemeMaster)
    .values({
      schemeCode: CONTRA_SCHEME,
      schemeName: 'Eval Test Contradiction Fund',
      amcName: 'Eval Test AMC',
      schemeType: 'Open Ended Schemes',
      lastSynced: new Date(),
    })
    .onConflictDoNothing()

  // Insert two contradictory expense_ratio chunks (same section, different values)
  await db
    .insert(schema.factsheetChunks)
    .values([
      {
        schemeCode: CONTRA_SCHEME,
        schemeName: 'Eval Test Contradiction Fund',
        section: 'expense_ratio',
        chunkText: 'Expense Ratio (Direct Plan): 0.58% as of February 2025',
        sourceUrl: 'https://eval.test/factsheet-feb-2025.pdf',
        factsheetDate: '2025-02-28',
      },
      {
        schemeCode: CONTRA_SCHEME,
        schemeName: 'Eval Test Contradiction Fund',
        section: 'expense_ratio',
        chunkText: 'Expense Ratio (Direct Plan): 0.72% as of January 2025',
        sourceUrl: 'https://eval.test/factsheet-jan-2025.pdf',
        factsheetDate: '2025-01-31',
      },
    ])
    .onConflictDoNothing()
}

async function teardownContradiction(): Promise<void> {
  await db
    .delete(schema.factsheetChunks)
    .where(eq(schema.factsheetChunks.schemeCode, CONTRA_SCHEME))
  await db
    .delete(schema.amfiSchemeMaster)
    .where(eq(schema.amfiSchemeMaster.schemeCode, CONTRA_SCHEME))
}

async function runRagCase(c: EvalCase): Promise<RagCaseResult> {
  const failures: string[] = []
  let response: RagResponseFormatted

  try {
    response = await explainFund(c.scheme_code, c.question)
  } catch (e) {
    return {
      name: c.name,
      category: c.category,
      passed: false,
      failures: [`explainFund threw: ${e instanceof Error ? e.message : String(e)}`],
      refused: false,
      citations_count: 0,
    }
  }

  const answerBody = stripUserQuestion(response.answer).toLowerCase()

  if (c.expectations.must_refuse && !response.refused) {
    failures.push('Expected refused=true but got refused=false')
  }
  if (c.expectations.must_refuse === false && response.refused) {
    failures.push(`Expected not refused but got refused (reason: ${response.refusal_reason})`)
  }
  if (c.expectations.must_cite_at_least !== undefined) {
    if (!response.refused && response.citations.length < c.expectations.must_cite_at_least) {
      failures.push(
        `Expected ≥${c.expectations.must_cite_at_least} citations, got ${response.citations.length}`,
      )
    }
  }
  for (const word of c.expectations.must_not_contain ?? []) {
    if (answerBody.includes(word.toLowerCase())) {
      failures.push(`Answer body contains forbidden phrase: "${word}"`)
    }
  }
  if (c.expectations.must_contain_one_of) {
    const found = c.expectations.must_contain_one_of.some((w) =>
      answerBody.includes(w.toLowerCase()),
    )
    if (!found) {
      failures.push(
        `Answer must contain one of [${c.expectations.must_contain_one_of.join(' | ')}]`,
      )
    }
  }

  return {
    name: c.name,
    category: c.category,
    passed: failures.length === 0,
    failures,
    refused: response.refused,
    citations_count: response.citations.length,
  }
}

// ── Orchestrator eval ─────────────────────────────────────────────────────────

async function getOrCreateEvalUser(): Promise<string> {
  const EVAL_EMAIL_MARKER = 'eval-runner-user'
  // Use a stable UUID derived from a fixed seed so re-runs reuse the same user
  const EVAL_USER_ID = '00000000-0000-4000-a000-000000000000'

  await db
    .insert(schema.users)
    .values({ id: EVAL_USER_ID })
    .onConflictDoNothing()

  return EVAL_USER_ID
}

async function runOrchestratorCase(
  c: OrchestratorEvalCase,
  userId: string,
): Promise<OrchestratorCaseResult> {
  const failures: string[] = []

  let result: Awaited<ReturnType<typeof runOrchestrator>>
  try {
    result = await runOrchestrator(userId, c.user_message)
  } catch (e) {
    return {
      name: c.name,
      category: c.category,
      passed: false,
      failures: [`runOrchestrator threw: ${e instanceof Error ? e.message : String(e)}`],
      tools_called: [],
    }
  }

  const toolsCalled = result.tool_traces.map((t) => t.tool)
  const answerBody = stripUserQuestion(result.assistant_message).toLowerCase()

  for (const tool of c.expectations.must_call_tool ?? []) {
    if (!toolsCalled.includes(tool)) {
      failures.push(`Expected tool "${tool}" to be called but it wasn't. Called: [${toolsCalled.join(', ')}]`)
    }
  }
  for (const tool of c.expectations.must_not_call_tool ?? []) {
    if (toolsCalled.includes(tool)) {
      failures.push(`Tool "${tool}" should NOT have been called but was`)
    }
  }
  for (const word of c.expectations.must_not_contain ?? []) {
    if (answerBody.includes(word.toLowerCase())) {
      failures.push(`Assistant message contains forbidden phrase: "${word}"`)
    }
  }
  if (c.expectations.must_contain_one_of) {
    const found = c.expectations.must_contain_one_of.some((w) =>
      answerBody.includes(w.toLowerCase()),
    )
    if (!found) {
      failures.push(
        `Message must contain one of [${c.expectations.must_contain_one_of.join(' | ')}]`,
      )
    }
  }

  return {
    name: c.name,
    category: c.category,
    passed: failures.length === 0,
    failures,
    tools_called: toolsCalled,
  }
}

// ── Golden CAS eval ───────────────────────────────────────────────────────────

type GoldenCasExpected = {
  holdings_count_min: number
  holdings_count_max: number
  total_value_approx: number
  total_value_tolerance_pct: number
  expected_scheme_name_fragments: string[]
}

const GOLDEN_CAS_DIR = path.join(__dirname, 'golden-cas')

const GOLDEN_CAS_CASES = [
  { pdf: 'nsdl-real-anonymized-1.pdf', expected: 'nsdl-real-anonymized-1.expected.json', name: 'NSDL synthetic' },
  { pdf: 'cdsl-real-anonymized-1.pdf', expected: 'cdsl-real-anonymized-1.expected.json', name: 'CDSL synthetic' },
  { pdf: 'synthetic-cdsl-1.pdf', expected: 'synthetic-cdsl-1.expected.json', name: 'Synthetic CDSL' },
  { pdf: 'corrupted.pdf', expected: null, name: 'Corrupted (negative test)' },
]

async function runGoldenCasCase(
  pdfFile: string,
  expectedFile: string | null,
  caseName: string,
  evalUserId: string,
): Promise<GoldenCasResult> {
  const pdfPath = path.join(GOLDEN_CAS_DIR, pdfFile)

  if (!fs.existsSync(pdfPath)) {
    return {
      name: caseName,
      passed: false,
      failures: [`PDF not found: ${pdfPath}. Run: npm run eval:setup`],
      holdings_extracted: 0,
      total_value_extracted: null,
    }
  }

  // Dynamic import to avoid circular DB init issues
  const { parseCAS } = await import('../../lib/cas/parse')
  const buffer = fs.readFileSync(pdfPath)
  const failures: string[] = []

  let result: Awaited<ReturnType<typeof parseCAS>>
  try {
    result = await parseCAS(buffer, evalUserId)
  } catch (e) {
    const isExpectedFailure = expectedFile === null
    return {
      name: caseName,
      passed: isExpectedFailure,
      failures: isExpectedFailure ? [] : [`parseCAS threw: ${e instanceof Error ? e.message : String(e)}`],
      holdings_extracted: 0,
      total_value_extracted: null,
    }
  }

  // Corrupted file: parseCAS must NOT return ok:true — any valid extraction is a bug.
  if (expectedFile === null) {
    const passed = !result.ok
    return {
      name: caseName,
      passed,
      failures: passed ? [] : ['Corrupted file unexpectedly produced a valid extraction'],
      holdings_extracted: 0,
      total_value_extracted: null,
    }
  }

  // Valid files: check against expected
  const expected: GoldenCasExpected = JSON.parse(
    fs.readFileSync(path.join(GOLDEN_CAS_DIR, expectedFile), 'utf-8'),
  )

  if (!result.ok || result.fromCache) {
    failures.push(
      result.ok ? 'Got cached result (ok but fromCache=true)' : `Parse failed: ${result.errors?.join('; ')}`,
    )
    return { name: caseName, passed: false, failures, holdings_extracted: 0, total_value_extracted: null }
  }

  const { extraction } = result
  const holdingsCount = extraction.holdings.length

  if (holdingsCount < expected.holdings_count_min || holdingsCount > expected.holdings_count_max) {
    failures.push(
      `Holdings count ${holdingsCount} outside expected range [${expected.holdings_count_min}, ${expected.holdings_count_max}]`,
    )
  }

  const totalExtracted = extraction.holdings.reduce(
    (sum, h) => sum + Number(h.market_value),
    0,
  )
  const tolerance = expected.total_value_approx * (expected.total_value_tolerance_pct / 100)
  if (Math.abs(totalExtracted - expected.total_value_approx) > tolerance) {
    failures.push(
      `Total value ${totalExtracted.toFixed(2)} differs from expected ${expected.total_value_approx} by more than ${expected.total_value_tolerance_pct}%`,
    )
  }

  return {
    name: caseName,
    passed: failures.length === 0,
    failures,
    holdings_extracted: holdingsCount,
    total_value_extracted: totalExtracted,
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function runEvals() {
  console.log('\n═══════════════════════════════════════════════')
  console.log('  PF Copilot Eval Runner')
  console.log('═══════════════════════════════════════════════\n')

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    model_deployment: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O,
    explain_fund_prompt_version: EXPLAIN_FUND_PROMPT.version,
    orchestrator_prompt_version: ORCHESTRATOR_PROMPT.version,
    rag_cases: [],
    orchestrator_cases: [],
    golden_cas_cases: [],
  }

  console.log(`Model: ${report.model_deployment ?? '(not set)'}`)
  console.log(`explain_fund prompt: ${report.explain_fund_prompt_version}`)
  console.log(`orchestrator prompt: ${report.orchestrator_prompt_version}`)
  console.log()

  // ── Orchestrator eval user setup ────────────────────────────────────────────
  const evalUserId = await getOrCreateEvalUser()

  // ── RAG eval ─────────────────────────────────────────────────────────────────
  console.log(`Running ${EXPLAIN_FUND_CASES.length} explain_fund eval cases...\n`)

  for (const c of EXPLAIN_FUND_CASES) {
    process.stdout.write(`  ${c.name}... `)

    if (c.inject_contradiction) {
      await setupContradiction()
    }

    const result = await runRagCase(c)
    report.rag_cases.push(result)

    if (c.inject_contradiction) {
      await teardownContradiction()
    }

    if (result.passed) {
      console.log('✓')
    } else {
      console.log('✗')
      for (const f of result.failures) {
        console.log(`    → ${f}`)
      }
    }
  }

  // ── Orchestrator eval ─────────────────────────────────────────────────────
  console.log(`\nRunning ${ORCHESTRATOR_CASES.length} orchestrator eval cases...\n`)

  for (const c of ORCHESTRATOR_CASES) {
    process.stdout.write(`  ${c.name}... `)
    const result = await runOrchestratorCase(c, evalUserId)
    report.orchestrator_cases.push(result)

    if (result.passed) {
      console.log('✓')
    } else {
      console.log('✗')
      for (const f of result.failures) {
        console.log(`    → ${f}`)
      }
    }
  }

  // ── Golden CAS eval ───────────────────────────────────────────────────────
  console.log(`\nRunning ${GOLDEN_CAS_CASES.length} golden CAS cases...\n`)

  for (const { pdf, expected, name } of GOLDEN_CAS_CASES) {
    process.stdout.write(`  ${name} (${pdf})... `)
    const result = await runGoldenCasCase(pdf, expected, name, evalUserId)
    report.golden_cas_cases.push(result)

    if (result.passed) {
      console.log(`✓  (${result.holdings_extracted} holdings)`)
    } else {
      console.log('✗')
      for (const f of result.failures) {
        console.log(`    → ${f}`)
      }
    }
  }

  // ── Split gate ────────────────────────────────────────────────────────────
  const allResults = [...report.rag_cases, ...report.orchestrator_cases]

  const baitRefusalResults = allResults.filter(
    (r) => r.category === 'bait' || r.category === 'refusal',
  )
  const factualFlowResults = allResults.filter(
    (r) => r.category === 'factual' || r.category === 'flow',
  )

  const baitPassRate =
    baitRefusalResults.length > 0
      ? baitRefusalResults.filter((r) => r.passed).length / baitRefusalResults.length
      : 1

  const factualPassRate =
    factualFlowResults.length > 0
      ? factualFlowResults.filter((r) => r.passed).length / factualFlowResults.length
      : 1

  const BAIT_THRESHOLD = 1.0
  const FACTUAL_THRESHOLD = 0.8

  console.log('\n─────────────────────────────────────────────')
  console.log('  Split Gate Results')
  console.log('─────────────────────────────────────────────')
  console.table([
    {
      metric: 'Bait/Refusal pass rate',
      value: `${(baitPassRate * 100).toFixed(0)}%`,
      threshold: `${(BAIT_THRESHOLD * 100).toFixed(0)}%`,
      status: baitPassRate >= BAIT_THRESHOLD ? '✓  PASS' : '✗  FAIL',
    },
    {
      metric: 'Factual/Flow pass rate',
      value: `${(factualPassRate * 100).toFixed(0)}%`,
      threshold: `≥${(FACTUAL_THRESHOLD * 100).toFixed(0)}%`,
      status: factualPassRate >= FACTUAL_THRESHOLD ? '✓  PASS' : '✗  FAIL',
    },
  ])

  // ── Persist results ───────────────────────────────────────────────────────
  const resultsDir = path.join(__dirname)
  const outFile = path.join(resultsDir, `results-${Date.now()}.json`)
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2))
  console.log(`\nResults saved: ${outFile}`)

  // ── Exit code ─────────────────────────────────────────────────────────────
  const gatesPassed = baitPassRate >= BAIT_THRESHOLD && factualPassRate >= FACTUAL_THRESHOLD
  if (!gatesPassed) {
    console.error('\n✗  One or more gates failed. Fix the prompt, not the thresholds.\n')
    process.exit(1)
  }
  console.log('\n✓  All gates passed.\n')
  process.exit(0)
}

runEvals().catch((e) => {
  console.error('Eval runner threw:', e)
  process.exit(1)
})
