"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface ProjectActionResult {
  ok: boolean;
  error?: string;
}

const TITLE_MIN = 3;
const TITLE_MAX = 120;

/**
 * Renames a roadmap.
 *
 * Only `projects.title` changes: the paper, the steps and the generated content
 * stay as they were. Collapsing inner whitespace keeps `"  My   roadmap "` from
 * becoming a title that renders with ragged gaps in the card layout.
 *
 * Ownership is enforced by RLS (`projects: update own`); the `id` filter only
 * narrows which of *your* rows is touched.
 */
export async function renameProject(
  projectId: string,
  rawTitle: string,
): Promise<ProjectActionResult> {
  const title = rawTitle.trim().replace(/\s+/g, " ");

  if (title.length < TITLE_MIN) {
    return { ok: false, error: `Use at least ${TITLE_MIN} characters.` };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to rename this roadmap." };
  }

  const { data, error } = await supabase
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

  revalidatePath("/dashboard");
  revalidatePath(`/project/${projectId}`);
  return { ok: true };
}

/**
 * Deletes a roadmap and, by cascade, its steps.
 *
 * The paper row is deliberately left behind: `projects.paper_id` is
 * `on delete restrict`, and papers are a shared cache keyed by arXiv id — any
 * other roadmap built from the same paper still points at it. Deleting a paper
 * here would either fail or, worse, silently remove someone else's source
 * material.
 *
 * A public share link stops working: it resolves through `projects.share_slug`,
 * so removing the row removes the link. The old URL then renders the normal
 * not-found UI (D32).
 */
export async function deleteProject(projectId: string): Promise<ProjectActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to delete this roadmap." };
  }

  const { data, error } = await supabase
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

  revalidatePath("/dashboard");
  revalidatePath(`/project/${projectId}`);
  return { ok: true };
}
