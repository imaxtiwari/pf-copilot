export interface Tripwire {
  field_name: string
  pattern: RegExp
  required_sources: string[]
  description: string
}

/**
 * HALLUCINATION_TRIPWIRES — patterns that detect high-risk financial claims.
 * If a pattern fires on a message payload but the payload contains no URL
 * from the required_sources list, ORACLE raises a HALLUCINATION_RISK flag.
 */
export const HALLUCINATION_TRIPWIRES: Tripwire[] = [
  {
    field_name: 'FUND_NAV',
    // Numeric values (e.g. 42.15, 1,234.56) near the word "nav" within 120 chars
    pattern: /nav\b.{0,120}?\b\d{1,6}(?:,\d{3})*(?:\.\d{1,4})?\b|\b\d{1,6}(?:,\d{3})*(?:\.\d{1,4})?\b.{0,120}?nav\b/i,
    required_sources: ['mfapi.in', 'amfiindia.com'],
    description: 'Fund NAV figure detected — must be sourced from mfapi.in or amfiindia.com'
  },
  {
    field_name: 'FUND_MANAGER_NAME',
    // Common Indian name patterns (2–3 capitalized words) near "fund manager"
    pattern: /fund\s+manager\b.{0,150}?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}.{0,150}?fund\s+manager/i,
    required_sources: ['amfiindia.com', 'valueresearchonline.com'],
    description: 'Fund manager name detected — must be sourced from amfiindia.com or valueresearchonline.com'
  },
  {
    field_name: 'SEBI_REGISTRATION',
    // SEBI registration numbers: IN followed by 7+ alphanumeric chars
    pattern: /\bIN[A-Z0-9]{7,}\b/,
    required_sources: ['sebi.gov.in'],
    description: 'SEBI registration number detected — must be sourced from sebi.gov.in'
  },
  {
    field_name: 'EXPENSE_RATIO',
    // Percentage values (e.g. 1.05%, 0.5%) near "expense ratio"
    pattern: /expense\s+ratio\b.{0,120}?\b\d{1,2}(?:\.\d{1,4})?\s*%|\b\d{1,2}(?:\.\d{1,4})?\s*%.{0,120}?expense\s+ratio/i,
    required_sources: ['valueresearchonline.com', 'morningstar.in'],
    description: 'Expense ratio figure detected — must be sourced from valueresearchonline.com or morningstar.in'
  },
  {
    field_name: 'INCEPTION_DATE',
    // Date patterns (DD/MM/YYYY, YYYY-MM-DD, Month YYYY) near "inception", "launched", "incepted"
    pattern: /(?:inception|launched|incepted)\b.{0,120}?\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})|\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}).{0,120}?(?:inception|launched|incepted)/i,
    required_sources: ['amfiindia.com', 'valueresearchonline.com'],
    description: 'Fund inception date detected — must be sourced from amfiindia.com or valueresearchonline.com'
  },
  {
    field_name: 'AUM_FIGURE',
    // Crore amounts (e.g. "₹12,345 crore", "12345 Cr") near AUM / assets under management
    pattern: /(?:aum|assets\s+under\s+management)\b.{0,150}?(?:₹\s*)?\d{1,7}(?:,\d{2,3})*(?:\.\d{1,2})?\s*(?:crore|cr\.?)\b|(?:₹\s*)?\d{1,7}(?:,\d{2,3})*(?:\.\d{1,2})?\s*(?:crore|cr\.?)\b.{0,150}?(?:aum|assets\s+under\s+management)/i,
    required_sources: ['amfiindia.com', 'valueresearchonline.com'],
    description: 'AUM figure detected — must be sourced from amfiindia.com or valueresearchonline.com'
  }
]
