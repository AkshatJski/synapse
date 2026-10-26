-- =============================================================================
-- Synapse — public share links (0002_sharing)
-- Run after 0001_init.sql. Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- projects gains an opt-in public handle.
--
-- `share_slug is null` means private (the default for every existing row).
-- The slug is generated server-side (12 chars of base64url) and is the only
-- thing a visitor needs — project ids stay unguessable and unused in public URLs.
-- -----------------------------------------------------------------------------
alter table public.projects
  add column if not exists share_slug text,
  add column if not exists shared_at  timestamptz;

-- Partial unique index: many private rows (null) are allowed, but a live slug
-- can never collide with another project's live slug.
create unique index if not exists projects_share_slug_key
  on public.projects (share_slug)
  where share_slug is not null;

comment on column public.projects.share_slug is
  'Opt-in public handle. Null = private. Anyone with the slug may read the roadmap.';

-- =============================================================================
-- Read policies for shared content
--
-- These are deliberately declared without a `to <role>` clause, i.e. `to public`.
-- That matters: a signed-in visitor must be able to open someone else's share
-- link too. Restricting the policy to `anon` would make shared links 404 for
-- every logged-in user, which is the easy bug to ship here.
--
-- Postgres ORs permissive policies together, so these only ever *add* read
-- access; `projects: read own` and friends are untouched.
-- =============================================================================

-- ---- projects -----------------------------------------------------------------
drop policy if exists "projects: read shared" on public.projects;

create policy "projects: read shared"
  on public.projects for select
  using (share_slug is not null);

-- ---- steps --------------------------------------------------------------------
-- Only the steps of a shared project. Ownership still derives from the parent.
drop policy if exists "steps: read shared" on public.steps;

create policy "steps: read shared"
  on public.steps for select
  using (
    exists (
      select 1
      from public.projects p
      where p.id = steps.project_id
        and p.share_slug is not null
    )
  );

-- ---- papers -------------------------------------------------------------------
-- An anonymous visitor still needs the paper card. Limit it to papers that are
-- actually referenced by a shared project, so the cache as a whole stays private.
drop policy if exists "papers: read shared" on public.papers;

create policy "papers: read shared"
  on public.papers for select
  using (
    exists (
      select 1
      from public.projects p
      where p.paper_id = papers.id
        and p.share_slug is not null
    )
  );

-- =============================================================================
-- Deliberate omission
--
-- `projects.user_id` stays readable by anonymous visitors for shared rows,
-- because revoking it would require table-level column grants and would make
-- PostgREST queries fail in ways that are hard to diagnose. It is a random UUID
-- that exposes no profile data (profiles remain authenticated-only), and the
-- public page never selects or renders it. Revisit if the schema ever stores
-- anything sensitive on `projects`.
-- =============================================================================
