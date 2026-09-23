-- 行事曆 App 的雲端資料表
-- 用法：Supabase 左側 SQL Editor → 貼上整段 → Run（重複執行也安全）
--
-- 設計：所有本機資料表（任務、標籤、課程…）都存在同一張 records，
-- tbl 記是哪一種、data 放整筆 JSON。App 之後加欄位不用改資料庫。

create table if not exists public.records (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text not null,          -- tasks / tags / courses / ... / meta
  data       jsonb not null,         -- 整筆資料（含 updated_at、deleted_at）
  updated_at timestamptz not null,   -- 裝置端修改時間：用來決定誰新（最後寫入者勝）
  deleted_at timestamptz,            -- 軟刪除
  synced_at  timestamptz not null default now()  -- 伺服器收到時間：各裝置用它抓「上次之後的變動」
);

create index if not exists records_user_synced on public.records (user_id, synced_at);
create index if not exists records_user_tbl on public.records (user_id, tbl);

-- 只能讀寫自己的資料
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
drop policy if exists "records_insert_own" on public.records;
drop policy if exists "records_update_own" on public.records;
drop policy if exists "records_delete_own" on public.records;
create policy "records_select_own" on public.records for select to authenticated using (user_id = auth.uid());
create policy "records_insert_own" on public.records for insert to authenticated with check (user_id = auth.uid());
create policy "records_update_own" on public.records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "records_delete_own" on public.records for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.records to authenticated;

-- 較舊的寫入不覆蓋較新的；每次寫入都更新 synced_at
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
  for each row execute function public.records_lww();

-- 即時同步：另一台裝置改了，這台馬上收到
do $$
begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null;
end $$;
