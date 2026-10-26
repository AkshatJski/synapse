"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isMissingSharingColumn } from "@/lib/sharing";
import { createClient } from "@/lib/supabase/server";

export interface ShareResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

const MIGRATION_HINT =
  "Public links need the 0002_sharing.sql migration. Run it in the Supabase SQL editor, then try again.";

/**
 * Turns sharing on for a project and returns its slug.
 *
 * Idempotent: if the project is already shared, the existing slug comes back
 * untouched. That matters because the button may be double-clicked, and because
 * rotating the slug on every click would silently break links already sent out.
 *
 * Ownership is enforced by RLS (`projects: update own`); the explicit `id`
 * filter only narrows the row, it is not the security boundary.
 */
export async function enableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to create a link." };
  }

  const { data: existing, error: readError } = await supabase
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

  // 9 random bytes -> 12 base64url chars (~72 bits). Unguessable, and short
  // enough to survive being pasted into a chat window unmangled.
  const slug = randomBytes(9).toString("base64url");

  const { data, error } = await supabase
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

  revalidatePath(`/project/${projectId}`);
  return { ok: true, slug: data.share_slug };
}

/**
 * Revokes sharing. The slug is discarded rather than kept dormant, so a future
 * re-share produces a different URL and old links cannot spring back to life.
 */
export async function disableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Sign in again to change sharing." };
  }

  const { data, error } = await supabase
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

  revalidatePath(`/project/${projectId}`);
  return { ok: true };
}
