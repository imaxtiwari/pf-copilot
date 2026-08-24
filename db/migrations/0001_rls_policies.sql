-- Migration: enable Row Level Security for all user-scoped tables.
-- Intended for use with Supabase Auth. Policies reference auth.uid(), which
-- evaluates to the authenticated user's UUID when the connection role is
-- "authenticated" and request.jwt.claims.sub is set to the user ID.

-- ── Legacy user migration column ──────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "legacy_user_id" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "users_legacy_user_id_idx" ON "users" USING btree ("legacy_user_id");

-- ── Enable RLS on user-scoped tables ──────────────────────────────────────────

ALTER TABLE "cas_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_holdings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demat_holdings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profile" ENABLE ROW LEVEL SECURITY;

-- ── cas_uploads ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cas_uploads_select_own" ON "cas_uploads";
DROP POLICY IF EXISTS "cas_uploads_insert_own" ON "cas_uploads";
DROP POLICY IF EXISTS "cas_uploads_update_own" ON "cas_uploads";
DROP POLICY IF EXISTS "cas_uploads_delete_own" ON "cas_uploads";

CREATE POLICY "cas_uploads_select_own" ON "cas_uploads" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "cas_uploads_insert_own" ON "cas_uploads" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "cas_uploads_update_own" ON "cas_uploads" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "cas_uploads_delete_own" ON "cas_uploads" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── portfolio_holdings ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "portfolio_holdings_select_own" ON "portfolio_holdings";
DROP POLICY IF EXISTS "portfolio_holdings_insert_own" ON "portfolio_holdings";
DROP POLICY IF EXISTS "portfolio_holdings_update_own" ON "portfolio_holdings";
DROP POLICY IF EXISTS "portfolio_holdings_delete_own" ON "portfolio_holdings";

CREATE POLICY "portfolio_holdings_select_own" ON "portfolio_holdings" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "portfolio_holdings_insert_own" ON "portfolio_holdings" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_holdings_update_own" ON "portfolio_holdings" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_holdings_delete_own" ON "portfolio_holdings" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── portfolio_snapshots ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "portfolio_snapshots_select_own" ON "portfolio_snapshots";
DROP POLICY IF EXISTS "portfolio_snapshots_insert_own" ON "portfolio_snapshots";
DROP POLICY IF EXISTS "portfolio_snapshots_update_own" ON "portfolio_snapshots";
DROP POLICY IF EXISTS "portfolio_snapshots_delete_own" ON "portfolio_snapshots";

CREATE POLICY "portfolio_snapshots_select_own" ON "portfolio_snapshots" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "portfolio_snapshots_insert_own" ON "portfolio_snapshots" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_snapshots_update_own" ON "portfolio_snapshots" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_snapshots_delete_own" ON "portfolio_snapshots" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── chat_messages ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "chat_messages_select_own" ON "chat_messages";
DROP POLICY IF EXISTS "chat_messages_insert_own" ON "chat_messages";
DROP POLICY IF EXISTS "chat_messages_update_own" ON "chat_messages";
DROP POLICY IF EXISTS "chat_messages_delete_own" ON "chat_messages";

CREATE POLICY "chat_messages_select_own" ON "chat_messages" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "chat_messages_insert_own" ON "chat_messages" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "chat_messages_update_own" ON "chat_messages" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "chat_messages_delete_own" ON "chat_messages" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── demat_holdings ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "demat_holdings_select_own" ON "demat_holdings";
DROP POLICY IF EXISTS "demat_holdings_insert_own" ON "demat_holdings";
DROP POLICY IF EXISTS "demat_holdings_update_own" ON "demat_holdings";
DROP POLICY IF EXISTS "demat_holdings_delete_own" ON "demat_holdings";

CREATE POLICY "demat_holdings_select_own" ON "demat_holdings" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "demat_holdings_insert_own" ON "demat_holdings" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "demat_holdings_update_own" ON "demat_holdings" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "demat_holdings_delete_own" ON "demat_holdings" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── portfolio_insights ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "portfolio_insights_select_own" ON "portfolio_insights";
DROP POLICY IF EXISTS "portfolio_insights_insert_own" ON "portfolio_insights";
DROP POLICY IF EXISTS "portfolio_insights_update_own" ON "portfolio_insights";
DROP POLICY IF EXISTS "portfolio_insights_delete_own" ON "portfolio_insights";

CREATE POLICY "portfolio_insights_select_own" ON "portfolio_insights" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "portfolio_insights_insert_own" ON "portfolio_insights" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_insights_update_own" ON "portfolio_insights" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "portfolio_insights_delete_own" ON "portfolio_insights" FOR DELETE TO authenticated USING ("user_id" = auth.uid());

-- ── user_profile ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_profile_select_own" ON "user_profile";
DROP POLICY IF EXISTS "user_profile_insert_own" ON "user_profile";
DROP POLICY IF EXISTS "user_profile_update_own" ON "user_profile";
DROP POLICY IF EXISTS "user_profile_delete_own" ON "user_profile";

CREATE POLICY "user_profile_select_own" ON "user_profile" FOR SELECT TO authenticated USING ("user_id" = auth.uid());
CREATE POLICY "user_profile_insert_own" ON "user_profile" FOR INSERT TO authenticated WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "user_profile_update_own" ON "user_profile" FOR UPDATE TO authenticated USING ("user_id" = auth.uid()) WITH CHECK ("user_id" = auth.uid());
CREATE POLICY "user_profile_delete_own" ON "user_profile" FOR DELETE TO authenticated USING ("user_id" = auth.uid());
