/**
 * Generates synthetic CAS PDF files for eval testing.
 * Run: npm run eval:setup
 *
 * Text layout is deliberately structured to match what lib/cas/parse-text.ts
 * expects — see parseHoldings() and extractTotal() in that file.
 *
 * Key constraints:
 *  - Folio lines:  "Folio No: <ALPHA/DIGIT/SLASH>"  (no hyphens — capture group stops there)
 *  - Value lines:  three bare numbers "units   nav   value" — nothing else on the line
 *  - Scheme name:  the line immediately before the value line (no header rows between them)
 *  - Total line:   "TOTAL PORTFOLIO VALUE: <number>"  — no "Rs." prefix
 *  - Date:         "As On: DD-MMM-YYYY"  so extractDate() can parse it
 *
 * TODO: Replace nsdl-real-anonymized-1.pdf and cdsl-real-anonymized-1.pdf
 *       with real anonymized samples before shipping.
 *       Anonymization checklist:
 *         ✓ Names blacked out
 *         ✓ PAN numbers blacked out
 *         ✓ Folio numbers replaced with XXXX/XXXX patterns
 *         ✓ Addresses blacked out
 *         ✓ Total values can stay (not PII)
 *         ✓ Scheme names can stay (public data)
 */

import * as path from 'path'
import * as fs from 'fs'
import PDFDocument from 'pdfkit'

const OUT_DIR = path.join(__dirname)

function writePdf(filename: string, lines: string[][]): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(OUT_DIR, filename)
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const stream = fs.createWriteStream(outPath)

    doc.pipe(stream)
    doc.font('Courier').fontSize(9)

    let y = 50
    const lineHeight = 12

    for (const group of lines) {
      for (const line of group) {
        if (y > 750) {
          doc.addPage()
          y = 50
        }
        doc.text(line, 50, y)
        y += lineHeight
      }
      y += 4  // extra space between groups
    }

    doc.end()
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

// ── Synthetic NSDL CAS ────────────────────────────────────────────────────────
//
// parseHoldings primary path:
//   Line i-1  = scheme name  (first candidate passing all three filters)
//   Line i    = pure value line  ^(units)\s+(nav)\s+(market_value)$
//
// extractDate:  "As On: 31-Mar-2025"  → asOnMatch branch
// extractTotal: "TOTAL PORTFOLIO VALUE: 24504.30"  → no "Rs." prefix

const NSDL_CONTENT: string[][] = [
  [
    'NSDL CONSOLIDATED ACCOUNT STATEMENT',
    'For the period: 01-Jan-2025 To 31-Mar-2025',
    'As On: 31-Mar-2025',
    '',
    'Investor : XXXX XXXX',
    'PAN      : XXXXXXXXXX',
    'Email    : xxxxx@example.com',
  ],
  [
    // Holding 1 — Parag Parikh Flexi Cap
    // Folio captures "XXXX/0001" (slash allowed, stops at space)
    'Folio No: XXXX/0001  PAN: XXXXXXXXXX',
    'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    '100.0000   80.1234   8012.34',
  ],
  [
    // Holding 2 — Axis Bluechip
    'Folio No: XXXX/0002  PAN: XXXXXXXXXX',
    'Axis Bluechip Fund - Direct Growth',
    '200.0000   52.3456   10469.12',
  ],
  [
    // Holding 3 — HDFC Mid-Cap
    'Folio No: XXXX/0003  PAN: XXXXXXXXXX',
    'HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth',
    '50.0000   120.4567   6022.84',
  ],
  [
    'TOTAL PORTFOLIO VALUE: 24504.30',
    '(Value as on 31-Mar-2025)',
    '',
    'Note: NAV and value figures are indicative only.',
    'Please verify with respective AMC / Registrar.',
  ],
]

// ── Synthetic CDSL CAS ────────────────────────────────────────────────────────
//
// Uses the same NSDL-style 3-line-per-holding format so parseCASText can
// extract holdings via the primary path rather than the CDSL table fallback.
// "CDSL" in the header keeps detectSource() returning 'CDSL'.

const CDSL_CONTENT: string[][] = [
  [
    'CDSL Ventures Limited',
    'CONSOLIDATED ACCOUNT STATEMENT',
    'Period: 01-Jan-2025 to 31-Mar-2025',
    'As On: 31-Mar-2025',
    '',
    'Investor Name : XXXX XXXX',
    'PAN           : XXXXXXXXXX',
    'Email         : xxxxx@example.com',
  ],
  [
    // Holding 1 — Mirae Asset Emerging Bluechip
    'Folio No: XXXX/0010  PAN: XXXXXXXXXX',
    'Mirae Asset Emerging Bluechip Fund - Direct Plan',
    '75.0000   110.5678   8292.59',
  ],
  [
    // Holding 2 — SBI Small Cap
    'Folio No: XXXX/0011  PAN: XXXXXXXXXX',
    'SBI Small Cap Fund - Direct Plan - Growth',
    '30.0000   145.2345   4357.04',
  ],
  [
    'TOTAL PORTFOLIO VALUE: 12649.63',
    '',
    'This is a computer generated statement.',
    'Investor helpline: XXXXXXXXXX',
  ],
]

// ── Another synthetic CDSL (labelled explicitly synthetic) ────────────────────

const SYNTHETIC_CDSL_CONTENT: string[][] = [
  [
    'CDSL Ventures Limited',
    'CONSOLIDATED ACCOUNT STATEMENT',
    'Period: 01-Jan-2025 to 31-Mar-2025',
    'As On: 31-Mar-2025',
    '',
    'Investor Name : TEST INVESTOR',
    'PAN           : TESTPAN000',
    'Email         : test@eval.local',
  ],
  [
    'Folio No: TEST/0001',
    'ICICI Prudential Bluechip Fund - Direct Plan - Growth',
    '500.0000   90.1234   45061.70',
  ],
  [
    'TOTAL PORTFOLIO VALUE: 45061.70',
    '',
    '(SYNTHETIC DATA - FOR TESTING ONLY)',
  ],
]

// ── Corrupted non-CAS PDF ─────────────────────────────────────────────────────
// Intentionally has no NSDL/CDSL marker → detectSource returns null → falls back
// to vision path → vision path should also fail → CAS validation rejects it.

const CORRUPTED_CONTENT: string[][] = [
  [
    'RESTAURANT MENU',
    '',
    'Starters',
    '  Paneer Tikka         Rs. 280',
    '  Spring Rolls         Rs. 220',
    '',
    'Main Course',
    '  Dal Makhani          Rs. 320',
    '  Butter Naan          Rs.  60',
    '',
    'This is NOT a CAS document.',
    'The CAS parser should fail validation on this file.',
  ],
]

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Generating synthetic CAS PDFs...')

  await writePdf('nsdl-real-anonymized-1.pdf', NSDL_CONTENT)
  console.log('  ✓ nsdl-real-anonymized-1.pdf (SYNTHETIC PLACEHOLDER — see TODO above)')

  await writePdf('cdsl-real-anonymized-1.pdf', CDSL_CONTENT)
  console.log('  ✓ cdsl-real-anonymized-1.pdf (SYNTHETIC PLACEHOLDER — see TODO above)')

  await writePdf('synthetic-cdsl-1.pdf', SYNTHETIC_CDSL_CONTENT)
  console.log('  ✓ synthetic-cdsl-1.pdf')

  await writePdf('corrupted.pdf', CORRUPTED_CONTENT)
  console.log('  ✓ corrupted.pdf (non-CAS content)')

  console.log('\nDone. 4 PDF files created in tests/eval/golden-cas/')
  console.log('NOTE: nsdl-real-anonymized-1.pdf and cdsl-real-anonymized-1.pdf are synthetic')
  console.log('      placeholders. Replace with real anonymized CAS before shipping.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
