-- AI 助理連線金鑰
-- 用法：Supabase 左側 SQL Editor → 貼上整段 → Run（重複執行也安全）
--
-- 每個使用者可以在 App 帳號頁產生自己的金鑰，貼進自己的 AI（MCP 自訂連接器）。
-- 資料庫只存金鑰的雜湊值，原始金鑰只在產生時顯示一次；撤銷＝刪掉這一列。

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text,
  prefix       text,                  -- 金鑰開頭幾碼，方便辨認是哪一把
  key_hash     text not null unique,  -- sha256(金鑰)
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.api_keys enable row level security;

drop policy if exists "api_keys_select_own" on public.api_keys;
drop policy if exists "api_keys_insert_own" on public.api_keys;
drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_select_own" on public.api_keys for select to authenticated using (user_id = auth.uid());
create policy "api_keys_insert_own" on public.api_keys for insert to authenticated with check (user_id = auth.uid());
create policy "api_keys_delete_own" on public.api_keys for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.api_keys to authenticated;
