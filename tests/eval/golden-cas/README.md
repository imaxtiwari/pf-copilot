# Golden CAS files

## Generating synthetic placeholders

```bash
npm run eval:setup
```

This runs `generate-synthetic.ts` via pdfkit to create 4 synthetic PDF fixtures.

## Files

| File | Type | Status |
|---|---|---|
| `nsdl-real-anonymized-1.pdf` | NSDL CAS | **SYNTHETIC PLACEHOLDER** — replace before shipping |
| `cdsl-real-anonymized-1.pdf` | CDSL CAS | **SYNTHETIC PLACEHOLDER** — replace before shipping |
| `synthetic-cdsl-1.pdf` | CDSL CAS | Explicitly synthetic — keep as is |
| `corrupted.pdf` | Non-CAS PDF | Negative test case — keep as is |

## Anonymization checklist for real CAS files

Before committing real CAS PDFs, verify:

- [ ] Investor names blacked out
- [ ] PAN numbers replaced with `XXXXXXXXXX`
- [ ] Folio numbers replaced with `XXXX-XXXX-NNNN` patterns
- [ ] Mobile numbers replaced with `XXXXXXXXXX`
- [ ] Email addresses replaced with `xxxxx@example.com`
- [ ] Physical address blacked out
- [ ] Total portfolio values can stay (not PII)
- [ ] Scheme names can stay (public AMFI data)
- [ ] Transaction dates can stay (not PII)
- [ ] NAV values can stay (public data)
- [ ] Units held can stay (not uniquely identifying if name/PAN are removed)

## .gitignore

Add real anonymized CAS files to `.gitignore` if you are not 100% confident
the anonymization is complete. Only commit after a second-person review.
