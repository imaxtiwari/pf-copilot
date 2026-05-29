# TODOS

---

## [ ] Log a warning when CAS date extraction falls back to today's date

**What:** Add a `logger.warn` in `parseCASText` when `extractDate` returns `null`, before the fallback to today's date.

```typescript
// lib/cas/parse-text.ts
const extractedDate = extractDate(text)
if (!extractedDate) {
  logger.warn({ preview: text.slice(0, 200) }, 'cas: extractDate returned null — using today as fallback')
}
const as_of_date = extractedDate ?? new Date().toISOString().slice(0, 10)
```

**Why:** Currently a CAS with an unrecognised date format silently gets today's date stamped on all its holdings. The import succeeds, the date is wrong, and the user never knows. A warn-level log turns a silent data quality bug into an observable event.

**File:** `lib/cas/parse-text.ts` — the line:
```typescript
const as_of_date = extractDate(text) ?? new Date().toISOString().slice(0, 10)
```

**Effort:** 2–3 lines. Zero risk — no behaviour change, just observability.

**Blocked by:** Nothing.
