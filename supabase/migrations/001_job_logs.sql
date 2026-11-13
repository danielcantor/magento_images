-- Historial de lotes del dashboard de imágenes.
create table if not exists public.job_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  kind text not null,
  total int not null default 0,
  ok int not null default 0,
  failed int not null default 0,
  errors jsonb not null default '[]'::jsonb
);

alter table public.job_logs enable row level security;

-- Cualquier usuario autenticado del equipo ve el historial; cada uno inserta solo como sí mismo.
create policy "leer historial" on public.job_logs
  for select to authenticated using (true);

create policy "insertar propio" on public.job_logs
  for insert to authenticated with check (user_id = auth.uid());

create index if not exists job_logs_created_at_idx on public.job_logs (created_at desc);
