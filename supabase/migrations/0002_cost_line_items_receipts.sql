-- =====================================================================
-- 0002: 費用の項目（line_items）とレシート画像（receipts）
--   - line_items: [{ id, name, amount_jpy, assignment }]  assignment は "split" か参加者の本名
--   - receipts  : [{ id, url, created_at }]  url は Storage の公開URL（バケット未作成時は data URL）
--   - 精算・Notion登録の正は従来どおり cost_breakdowns（line_items から保存時に自動導出）
-- =====================================================================
alter table public.costs
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists receipts   jsonb not null default '[]'::jsonb;

-- レシート画像用の Storage バケット（任意。未作成でも data URL で動作する）
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;
