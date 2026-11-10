-- À exécuter une fois dans Supabase > SQL Editor (ajout du compteur d'âge)
create table if not exists public.baby (
  id         smallint primary key default 1 check (id = 1),
  name       text,
  born_at    timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.baby (id) values (1) on conflict (id) do nothing;
alter table public.baby enable row level security;
