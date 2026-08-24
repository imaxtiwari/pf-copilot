# Migration Merge Log — Option A (Chat-First)

## Date
2026-08-24

## Decision
Adopt **Option A — chat-first tool-calling** per `docs/ARCHITECTURE_DECISION.md`. The Dhruv multi-agent pipeline, scheduler, agent memory, and related tables are removed from `main` and archived on the `feature/dhruv-pipeline` branch.

## Migration chain cleanup

`db/migrations/` contained duplicate filenames created by divergent migration runs. After deleting the duplicates and reviewing the generated metadata, the snapshot chain (`db/migrations/meta/*.json`) was found to be internally inconsistent — migration ids and `prevId` references did not form a valid sequence, and `drizzle-kit check` reported malformed snapshots.

Because the snapshot metadata could not be repaired without regenerating it, the migration folder was rebuilt from the canonical `db/schema.ts`:

1. Removed all existing SQL migration files and `meta/` snapshots.
2. Ran `npx drizzle-kit generate` to produce one clean baseline migration.
3. Result: `db/migrations/0000_absurd_iron_monger.sql` + `db/migrations/meta/0000_snapshot.json`.

This produces a single, linear, verifiable migration chain that `drizzle-kit check` validates.

### pgvector / HNSW
The baseline migration uses the `vector` column type. `db/migrate.ts` enables the `pgvector` extension **before** applying migrations and creates HNSW indexes on `factsheet_chunks.embedding` and `stock_documents.embedding` afterwards, so the generated SQL intentionally does not repeat that DDL.

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

## Trade-off: manual merge vs `drizzle-kit drop` + regenerate

| Approach | When to use | Risk |
|---|---|---|
| **Manual merge** | Divergent filenames but healthy snapshot metadata; want to keep production data. | Requires careful bookkeeping; easy to leave orphan files. |
| **Regenerate from canonical schema** (chosen) | Snapshot metadata is corrupt or the schema has been intentionally collapsed. | Loses the per-step migration history; existing production databases need their `drizzle.__drizzle_migrations` state reconciled before the new migration can be applied. |
| **`drizzle-kit drop` + regenerate** | Schema is fully canonical and you can afford to recreate the database. | **Destructive** — drops all tables and data. Not acceptable for a production deployment. |

We chose regeneration from the canonical schema because the duplicate migration runs had corrupted the snapshot metadata to the point that `drizzle-kit check` and `drizzle-kit generate` could not parse it. The SQL itself was preserved in spirit, but the only reliable way to obtain a valid, linear chain was to rebuild the migration folder from `db/schema.ts`.

### Production deployment note
For an existing database that has already run the old `0000`–`0007` migrations, do **not** simply run the new baseline migration — it will try to create tables that already exist. Recommended paths:

1. **Fresh database** (local, review apps): run `npm run db:migrate` normally.
2. **Existing production database**: back up, then either:
   - truncate `drizzle.__drizzle_migrations` and seed it with the new baseline hash (requires care), or
   - apply an idempotent reconciliation script that aligns the schema manually and records the baseline migration as applied.

## Trade-off: indexing strategy

| Strategy | Pros | Cons |
|---|---|---|
| **Simple B-tree indexes** (chosen) | Fast equality and range lookups; small storage overhead; easy to maintain. | May require separate indexes for each access pattern. |
| **Covering indexes** | Can satisfy queries without heap lookups for covered columns. | Larger storage; more columns to maintain on every write; overkill for tables with wide rows or many nullable JSON columns. |

We use simple B-tree indexes because the access patterns are well-defined (`user_id`, `(user_id, as_of_date)`, etc.) and the tables contain wide `jsonb` columns that would make covering indexes expensive.

## Verification
- `npx tsc --noEmit` passes.
- `npm run build` succeeds and emits only chat/portfolio routes.
- `npx vitest run` passes.
- `npx drizzle-kit check` reports "Everything's fine".

## Future work
- If Option B is revived, recreate the removed tables on `feature/dhruv-pipeline` and generate a new migration from that schema.
- Add a CI check that fails if `drizzle-kit generate --dry` produces diffs against the committed migrations.
