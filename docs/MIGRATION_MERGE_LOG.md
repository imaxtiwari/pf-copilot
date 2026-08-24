# Migration Merge Log — Option A (Chat-First)

## Date
2026-08-24

## Decision
Adopt **Option A — chat-first tool-calling** per `docs/ARCHITECTURE_DECISION.md`. The Dhruv multi-agent pipeline, scheduler, agent memory, and related tables are removed from `main` and archived on the `feature/dhruv-pipeline` branch.

## Migration chain cleanup

### Duplicates removed
`db/migrations/` contained duplicate filenames created by divergent migration runs. The untracked duplicates were deleted, leaving one linear chain:

| Order | Kept file | Deleted duplicate |
|---|---|---|
| 0000 | `0000_kind_hammerhead.sql` | — |
| 0001 | `0001_pgvector.sql` | `0001_chunky_dust.sql` |
| 0002 | `0002_portfolio_snapshots.sql` | `0002_productive_krista_starr.sql` |
| 0003 | `0003_amfi_category.sql` | `0003_misty_vapor.sql` |
| 0004 | `0004_portfolio_insights.sql` | `0004_chilly_eternity.sql` |
| 0005 | `0005_chat_audit.sql` | `0005_slimy_norrin_radd.sql` |
| 0006 | `0006_demat_tables.sql` | `0006_simple_trish_tilby.sql` |
| 0007 | `0007_embedding_dimensions.sql` | `0007_tan_wasp.sql` |

`db/migrations/meta/_journal.json` already references the kept files and did not require modification.

## Schema changes

### Removed tables
The following pipeline-only exports were removed from `db/schema.ts`:

- `pipelineRuns`
- `pipelineResults`
- `portfolioDrafts`
- `deliberationMessages`
- `committeeVotes`
- `comparisonReports`
- `complianceReports`
- `behavioralFingerprints`
- `agentFunds`
- `fundSnapshots`
- `fundCompositions`
- `driftReports`
- `sipAdherenceReports`
- `schedulerLocks`
- `schedulerRuns`
- `knowledgeCommons`

### Kept tables
The chat/portfolio surface retains:

- `users`
- `userProfile`
- `casUploads`
- `portfolioHoldings`
- `portfolioSnapshots`
- `dematHoldings`
- `chatMessages`
- `portfolioInsights`
- `amfiSchemeMaster`
- `factsheetChunks`
- `stockDocuments`

### Indexes added
- `users_created_at_idx`
- `user_profile_user_id_idx`
- `cas_uploads_user_id_idx`
- `portfolio_holdings_user_id_idx`
- `portfolio_holdings_user_scheme_idx`
- `portfolio_holdings_user_date_idx`
- `portfolio_insights_template_idx`
- `amfi_scheme_master_amfi_category_idx`
- `amfi_scheme_master_last_synced_idx`

Existing indexes on `portfolio_snapshots`, `chat_messages`, `demat_holdings`, `factsheet_chunks`, and `stock_documents` were preserved.

## How this was produced

1. Deleted untracked duplicate migration SQL files.
2. Rewrote `db/schema.ts` to contain only the chat-first table set.
3. Generated the new schema file directly; the existing `_journal.json` still matches the remaining SQL files.
4. Verified with `npx tsc --noEmit`, `npm run build`, and `npx vitest run` on the affected unit tests.

## Trade-off: manual merge vs `drizzle-kit drop` + regenerate

| Approach | When to use | Risk |
|---|---|---|
| **Manual merge** (chosen) | Divergent filenames but semantically compatible SQL; want to keep production data. | Requires careful bookkeeping; easy to leave orphan files. |
| **`drizzle-kit drop` + regenerate** | Schema is fully canonical and you can afford to recreate the database. | **Destructive** — drops all tables and data. Not acceptable for a production deployment. |

We chose manual merge because the duplicate files were naming artifacts, not semantic conflicts, and the production database already contains user CAS uploads, chat history, and portfolio holdings that must be preserved.

## Trade-off: indexing strategy

| Strategy | Pros | Cons |
|---|---|---|
| **Simple B-tree indexes** (chosen) | Fast equality and range lookups; small storage overhead; easy to maintain. | May require separate indexes for each access pattern. |
| **Covering indexes** | Can satisfy queries without heap lookups for covered columns. | Larger storage; more columns to maintain on every write; overkill for tables with wide rows or many nullable JSON columns. |

We use simple B-tree indexes because the access patterns are well-defined (`user_id`, `(user_id, as_of_date)`, etc.) and the tables contain wide `jsonb` columns that would make covering indexes expensive.

## Future work
- If Option B is revived, recreate the removed tables on `feature/dhruv-pipeline` and generate a new migration from that schema.
- Add a CI check that fails if `drizzle-kit generate --dry` produces diffs against the committed migrations.
