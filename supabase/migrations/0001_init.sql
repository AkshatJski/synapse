-- =============================================================================
-- Synapse — initial schema (0001_init)
-- Run this in the Supabase SQL editor (or `supabase db push`) on a fresh project.
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- profiles — public mirror of auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Public profile data linked 1:1 to auth.users.';

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Auto-create a profile whenever a user signs up (email or OAuth).
-- security definer so it can write to public.profiles from the auth schema.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'builder'
    ) || '_' || left(new.id::text, 4),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'Builder'), '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- papers — arXiv metadata cache (shared reference data)
-- -----------------------------------------------------------------------------
create table if not exists public.papers (
  id               uuid primary key default gen_random_uuid(),
  -- Stable cache key: version suffix deliberately excluded, so a v1 -> v2
  -- revision updates this row instead of creating a duplicate.
  arxiv_id         text not null unique,
  version          text,
  canonical_id     text,
  title            text not null,
  abstract         text not null,
  authors          jsonb not null default '[]'::jsonb,
  primary_category text,
  categories       text[] not null default '{}',
  published_date   timestamptz,
  abs_url          text,
  pdf_url          text,
  cached_at        timestamptz not null default now()
);

create index if not exists papers_primary_category_idx on public.papers (primary_category);
create index if not exists papers_published_date_idx on public.papers (published_date desc);

-- -----------------------------------------------------------------------------
-- projects — one generated roadmap
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  paper_id              uuid not null references public.papers (id) on delete restrict,
  domain                text not null,
  language              text not null,
  skill_level           text not null check (skill_level in ('beginner', 'intermediate', 'advanced')),
  title                 text not null,
  overview              text not null,
  eli5_summary          text,
  prerequisite_concepts text[] not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists projects_user_created_idx on public.projects (user_id, created_at desc);
create index if not exists projects_paper_idx on public.projects (paper_id);

-- -----------------------------------------------------------------------------
-- steps — ordered build tasks for a project
-- -----------------------------------------------------------------------------
create table if not exists public.steps (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  order_index    integer not null,
  title          text not null,
  description    text not null,
  code_snippet   text,
  estimated_time text,
  is_completed   boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (project_id, order_index)
);

create index if not exists steps_project_order_idx on public.steps (project_id, order_index);

-- =============================================================================
-- Row Level Security
-- The anon key is public by design — these policies are the only thing
-- standing between one user and another user's data.
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.papers   enable row level security;
alter table public.projects enable row level security;
alter table public.steps    enable row level security;

-- ---- profiles -----------------------------------------------------------------
drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: insert own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---- papers -------------------------------------------------------------------
-- Shared cache: any signed-in user may read and populate it. No deletes, and
-- updates are limited to refreshing arXiv metadata.
drop policy if exists "papers: read"    on public.papers;
drop policy if exists "papers: cache"   on public.papers;
drop policy if exists "papers: refresh" on public.papers;

create policy "papers: read"
  on public.papers for select
  to authenticated
  using (true);

create policy "papers: cache"
  on public.papers for insert
  to authenticated
  with check (true);

create policy "papers: refresh"
  on public.papers for update
  to authenticated
  using (true)
  with check (true);

-- ---- projects -----------------------------------------------------------------
drop policy if exists "projects: read own"   on public.projects;
drop policy if exists "projects: create own" on public.projects;
drop policy if exists "projects: update own" on public.projects;
drop policy if exists "projects: delete own" on public.projects;

create policy "projects: read own"
  on public.projects for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "projects: create own"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "projects: update own"
  on public.projects for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "projects: delete own"
  on public.projects for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---- steps --------------------------------------------------------------------
-- Ownership is derived from the parent project, never from a client-supplied id.
drop policy if exists "steps: read own"    on public.steps;
drop policy if exists "steps: create own"  on public.steps;
drop policy if exists "steps: update own"  on public.steps;
drop policy if exists "steps: delete own"  on public.steps;

create policy "steps: read own"
  on public.steps for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = steps.project_id and p.user_id = (select auth.uid())
    )
  );

create policy "steps: create own"
  on public.steps for insert
  to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = steps.project_id and p.user_id = (select auth.uid())
    )
  );

create policy "steps: update own"
  on public.steps for update
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = steps.project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = steps.project_id and p.user_id = (select auth.uid())
    )
  );

create policy "steps: delete own"
  on public.steps for delete
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = steps.project_id and p.user_id = (select auth.uid())
    )
  );
