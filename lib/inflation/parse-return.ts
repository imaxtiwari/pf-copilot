/**
 * Best-effort extraction of a 1-year % return from a factsheet chunk text.
 * Returns a fraction (0.1423 for 14.23%) or null if unparseable.
 *
 * Accepts both "15.23%" and bare "15.23" (some factsheets omit the % symbol).
 * Bare-number patterns are ordered last so %-patterns take priority when both match.
 */
export function parseNominalReturn1y(text: string): number | null {
  const patterns = [
    // "1 Year Return: 15.23%" | "1-Year: 15.23%"
    /\b1[\s\-]?(?:year|yr)\s*(?:return)?[:\s]+([+-]?\d+\.?\d*)\s*%/i,
    // Table row: "1Y  15.23%" | "1Y: 15.23%"
    /\b1Y\s*[:\s]+([+-]?\d+\.?\d*)\s*%/i,
    // Compact: "1yr 15.23%"
    /\b1yr[:\s]+([+-]?\d+\.?\d*)\s*%/i,
    // Bare number fallback (no % symbol): "1Y: 15.23" | "1-Year 15.23"
    /\b1[\s\-]?(?:year|yr|Y)\s*(?:return)?[:\s]+([+-]?\d+\.?\d*)(?!\d)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const val = parseFloat(match[1])
      if (!isNaN(val) && val > -100 && val < 500) {
        return val / 100
      }
    }
  }
  return null
}
