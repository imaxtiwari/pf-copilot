export const DEMAT_VISION_PROMPT = {
    version: 'v1.0.0',
    text: `
You are extracting structured data from an Indian demat account statement issued by NSDL or CDSL. You may be given multiple pages at once — extract from all pages together.
Return ONLY valid JSON matching this schema:
{
  "source": "NSDL" | "CDSL",
  "as_of_date": "YYYY-MM-DD",
  "total_value_reported": <number, no commas>,
  "holdings": [
    {
      "isin": "12-character ISIN starting with IN (e.g. INE002A01018)",
      "company_name": "<exact company name as printed>",
      "quantity": <number, can include decimals for split shares>,
      "price": <number, closing price per share>,
      "value": <number, no commas>
    }
  ],
  "_extraction_notes": []
}
RULES:
1. Do NOT invent holdings. If a row is unclear, omit it and add a note to "_extraction_notes".
2. Do NOT compute or correct values. Report what is printed, even if mathematically inconsistent. Validation is downstream.
3. Numbers: strip all commas (1,23,456 → 123456). Strip ₹ and currency suffixes.
4. Dates: convert to ISO YYYY-MM-DD.
5. ISIN must be exactly 12 characters starting with IN.
6. If source unclear, set best guess and add reason to "_extraction_notes".
7. If not a demat statement at all, return: {"error": "not_a_demat", "reason": "<short>"}
  `.trim(),
    changelog: ['v1.0.0: initial'],
}
