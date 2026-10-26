/**
 * lib/project-ops.ts
 *
 * The bodies of the project/share server actions, separated from Next so they
 * can be run against a fake client in `verify:actions`.
 *
 * The actions themselves (`app/actions/*.ts`) stay two lines long: build the
 * real client, call one function here. That split is what makes the rules —
 * trim and collapse a title, never rotate a live slug, treat "no row" as
 * not-yours — testable without a session, a database or a browser.
 *
 * Security note: ownership is enforced by RLS, not by these functions. Every
 * query is scoped by `id` only to narrow which of *your* rows is touched.
 */

import { randomBytes } from "node:crypto";

import { isMissingSharingColumn, type PostgrestLikeError } from "@/lib/sharing";

export interface ProjectActionResult {
  ok: boolean;
  error?: string;
}

export interface ShareResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

export type Revalidate = (path: string) => void;

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;

const MIGRATION_HINT =
  "Public links need the 0002_sharing.sql migration. Run it in the Supabase SQL editor, then try again.";

/* -------------------------------------------------------------------------- */
/*  The tiny slice of Supabase these functions need                            */
/* -------------------------------------------------------------------------- */

export type QueryError = PostgrestLikeError | null;

export interface QueryResult<T> {
  data: T | null;
  error: QueryError;
}

/** Chainable PostgREST builder — only the methods used below. */
export interface QueryBuilder {
  select(columns?: string): QueryBuilder;
  update(values: Record<string, unknown>): QueryBuilder;
  delete(): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  maybeSingle<T = unknown>(): Promise<QueryResult<T>>;
}

export interface ActionsClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
  from(table: string): QueryBuilder;
}

/* -------------------------------------------------------------------------- */
/*  Rename                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Only `projects.title` changes: the paper, the steps and the generated content
 * stay as they were. Collapsing inner whitespace keeps `"  My   roadmap "` from
 * becoming a title that renders with ragged gaps in the card layout.
 */
export async function renameProjectWith(
  client: ActionsClient,
  projectId: string,
  rawTitle: string,
  revalidate: Revalidate,
): Promise<ProjectActionResult> {
  const title = rawTitle.trim().replace(/\s+/g, " ");

  if (title.length < TITLE_MIN) {
    return { ok: false, error: `Use at least ${TITLE_MIN} characters.` };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  }

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to rename this roadmap." };
  }

  const { data, error } = await client
    .from("projects")
    .update({ title })
    .eq("id", projectId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[projects] rename failed", error);
    return { ok: false, error: "Could not rename that roadmap." };
  }

  if (!data) {
    return { ok: false, error: "That roadmap does not exist, or it is not yours." };
  }

  revalidate("/dashboard");
  revalidate(`/project/${projectId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Delete                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Deletes a roadmap and, by cascade, its steps.
 *
 * The paper row is deliberately left behind: `projects.paper_id` is
 * `on delete restrict`, and papers are a shared cache keyed by arXiv id — any
 * other roadmap built from the same paper still points at it.
 *
 * A public share link stops working: it resolves through `projects.share_slug`,
 * so removing the row removes the link (D32).
 */
export async function deleteProjectWith(
  client: ActionsClient,
  projectId: string,
  revalidate: Revalidate,
): Promise<ProjectActionResult> {
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to delete this roadmap." };
  }

  const { data, error } = await client
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[projects] delete failed", error);
    return { ok: false, error: "Could not delete that roadmap." };
  }

  if (!data) {
    // RLS filtered the row out, or it was already gone (double click, another tab).
    return { ok: false, error: "That roadmap does not exist, or it is not yours." };
  }

  revalidate("/dashboard");
  revalidate(`/project/${projectId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Sharing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turns sharing on and returns the slug.
 *
 * Idempotent: an existing slug comes back untouched. Rotating it on every click
 * would silently break links already sent out.
 */
export async function enableSharingWith(
  client: ActionsClient,
  projectId: string,
  revalidate: Revalidate,
  makeSlug: () => string = () => randomBytes(9).toString("base64url"),
): Promise<ShareResult> {
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to create a link." };
  }

  const { data: existing, error: readError } = await client
    .from("projects")
    .select("share_slug")
    .eq("id", projectId)
    .maybeSingle<{ share_slug: string | null }>();

  if (readError) {
    console.error("[sharing] read failed", readError);
    return {
      ok: false,
      error: isMissingSharingColumn(readError) ? MIGRATION_HINT : "Could not read that roadmap.",
    };
  }

  if (!existing) {
    return { ok: false, error: "That roadmap does not exist, or it is not yours." };
  }

  if (existing.share_slug) {
    return { ok: true, slug: existing.share_slug };
  }

  // 9 random bytes -> 12 base64url chars (~72 bits): unguessable, short enough
  // to survive being pasted into a chat window unmangled.
  const slug = makeSlug();

  const { data, error } = await client
    .from("projects")
    .update({ share_slug: slug, shared_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("share_slug")
    .maybeSingle<{ share_slug: string | null }>();

  if (error) {
    console.error("[sharing] enable failed", error);
    return {
      ok: false,
      error: isMissingSharingColumn(error) ? MIGRATION_HINT : "Could not create a share link.",
    };
  }

  if (!data?.share_slug) {
    return { ok: false, error: "That roadmap does not exist, or it is not yours." };
  }

  revalidate(`/project/${projectId}`);
  return { ok: true, slug: data.share_slug };
}

/**
 * Revokes sharing. The slug is discarded rather than kept dormant, so a future
 * re-share produces a different URL and old links cannot spring back to life.
 */
export async function disableSharingWith(
  client: ActionsClient,
  projectId: string,
  revalidate: Revalidate,
): Promise<ShareResult> {
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to change sharing." };
  }

  const { data, error } = await client
    .from("projects")
    .update({ share_slug: null, shared_at: null })
    .eq("id", projectId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[sharing] disable failed", error);
    return {
      ok: false,
      error: isMissingSharingColumn(error) ? MIGRATION_HINT : "Could not stop sharing.",
    };
  }

  if (!data) {
    return { ok: false, error: "That roadmap does not exist, or it is not yours." };
  }

  revalidate(`/project/${projectId}`);
  return { ok: true };
}
