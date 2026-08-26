-- ============================================================
-- MoneyControl · Setup de sincronización en la nube (Supabase)
-- Ejecutar UNA SOLA VEZ en: Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Tabla: una fila por usuario con su store completo (local-first sync)
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: cada usuario SOLO puede ver/modificar su propia fila
alter table public.user_data enable row level security;

create policy "user_data_select_own" on public.user_data
  for select using (auth.uid() = user_id);

create policy "user_data_insert_own" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "user_data_update_own" on public.user_data
  for update using (auth.uid() = user_id);
