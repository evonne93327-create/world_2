-- ==========================================================
-- 世界觀架構工作台：雲端同步資料表
-- 在 Supabase 專案的 SQL Editor 整份貼上執行一次即可。
-- ==========================================================

-- 一個帳號一列，整包 appData 存成 jsonb。
-- version 用來做樂觀鎖（偵測「別台裝置在我之後改過」），
-- 由資料庫端的 trigger 維護，不信任用戶端送來的值——
-- 用戶端的時鐘可能是錯的，拿它當依據會誤判衝突。
create table if not exists public.world_data (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  data       jsonb       not null,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now()
);

-- 每次寫入都由資料庫自己推進 version 與 updated_at
create or replace function public.world_data_touch()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE') then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists world_data_touch on public.world_data;
create trigger world_data_touch
  before insert or update on public.world_data
  for each row execute function public.world_data_touch();

-- ==========================================================
-- Row Level Security：每個帳號只看得到、也只改得動自己那一列。
-- 這是 anon key 可以公開放在前端的前提，一定要開。
-- ==========================================================
alter table public.world_data enable row level security;

drop policy if exists "read own row"   on public.world_data;
drop policy if exists "insert own row" on public.world_data;
drop policy if exists "update own row" on public.world_data;
drop policy if exists "delete own row" on public.world_data;

create policy "read own row" on public.world_data
  for select using (auth.uid() = user_id);

create policy "insert own row" on public.world_data
  for insert with check (auth.uid() = user_id);

create policy "update own row" on public.world_data
  for update using (auth.uid() = user_id)
              with check (auth.uid() = user_id);

create policy "delete own row" on public.world_data
  for delete using (auth.uid() = user_id);
