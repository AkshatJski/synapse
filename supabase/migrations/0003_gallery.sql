-- =============================================================================
-- Synapse — opt-in public gallery (0003_gallery)
-- Run after 0002_sharing.sql. Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Listing is a second, separate opt-in on top of sharing.
--
-- `share_slug is not null` means "anyone with the link may read this".
-- `gallery_listed` means "and it may also appear in the public /gallery index".
--
-- Both gates are required, and a project without a live slug can never be
-- listed: revoking the link removes the row from the gallery in the same update.
-- -----------------------------------------------------------------------------
alter table public.projects
  add column if not exists gallery_listed boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_gallery_requires_share'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_gallery_requires_share
      check (not gallery_listed or share_slug is not null);
  end if;
end
$$;

-- The gallery query is always `gallery_listed = true`, newest first, often
-- narrowed by domain. A partial index keeps it small however many private rows
-- exist.
create index if not exists projects_gallery_idx
  on public.projects (created_at desc)
  where gallery_listed and share_slug is not null;

comment on column public.projects.gallery_listed is
  'Opt-in second gate: true = also listed in /gallery. Requires a live share_slug.';

-- =============================================================================
-- No new read policy
--
-- `projects: read shared` (0002) already allows anonymous reads of any row with
-- a non-null share_slug. The gallery is a *query filter* over that same set
-- (`gallery_listed = true`), not a wider grant. Doing it this way means a bug in
-- the gallery page can never expose a private roadmap: RLS would still refuse.
--
-- `steps` and `papers` follow their parent through the existing shared policies,
-- which is why the gallery can show a step count without a second grant.
-- =============================================================================
