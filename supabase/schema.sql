-- Schéma Supabase pour le suivi bébé.
-- À exécuter une fois dans Supabase > SQL Editor.

create table if not exists public.diapers (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  pee         boolean not null default false,
  poo         boolean not null default false,
  poo_level   smallint check (poo_level between 1 and 3),
  note        text,
  created_at  timestamptz not null default now(),
  constraint diaper_not_empty check (pee or poo),
  constraint poo_level_only_with_poo check (poo or poo_level is null)
);

create index if not exists diapers_occurred_at_idx on public.diapers (occurred_at desc);

create table if not exists public.feedings (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,             -- null = tétée en cours
  duration_seconds integer check (duration_seconds >= 0),
  side             text check (side in ('G', 'D')),
  created_at       timestamptz not null default now()
);

create index if not exists feedings_started_at_idx on public.feedings (started_at desc);
-- Une seule tétée en cours à la fois
create unique index if not exists feedings_one_active_idx on public.feedings ((true)) where ended_at is null;

-- RLS activé SANS policy : la clé publique (anon) n'a aucun accès.
-- L'app passe uniquement par le serveur Next.js avec la clé service_role.
alter table public.diapers  enable row level security;
alter table public.feedings enable row level security;
