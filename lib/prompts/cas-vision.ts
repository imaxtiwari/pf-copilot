export const CAS_VISION_PROMPT = {
  version: 'v1.0.0',
  text: `
You are extracting structured data from an Indian mutual fund Consolidated Account Statement (CAS) issued by NSDL or CDSL. You may be given multiple pages at once — extract from all pages together.
Return ONLY valid JSON matching this schema:
{
  "source": "NSDL" | "CDSL",
  "as_of_date": "YYYY-MM-DD",
  "total_value_reported": <number, no commas>,
  "holdings": [
    {
      "folio_number": "<string>",
      "scheme_name": "<exact name as printed>",
      "units": <number, up to 4 decimals>,
      "nav": <number, up to 4 decimals>,
      "market_value": <number, no commas>
    }
  ],
  "_extraction_notes": []
}
RULES:
1. Do NOT invent holdings. If a scheme is unclear, omit it and add a note to "_extraction_notes".
2. Do NOT compute or correct values. Report what is printed, even if wrong. Validation is downstream.
3. Numbers: strip all commas (1,23,456 → 123456). Strip ₹. Strip currency suffixes.
4. Dates: convert to ISO YYYY-MM-DD.
5. If source unclear, set best guess and add reason to "_extraction_notes".
6. If not a CAS at all, return: {"error": "not_a_cas", "reason": "<short>"}
  `.trim(),
  changelog: ['v1.0.0: initial'],
}
