"use server";

import { revalidatePath } from "next/cache";

import {
  deleteProjectWith,
  renameProjectWith,
  type ActionsClient,
  type ProjectActionResult,
} from "@/lib/project-ops";
import { createClient } from "@/lib/supabase/server";

export type { ProjectActionResult };

/**
 * The rules live in `lib/project-ops.ts` so they can be run against a fake
 * client in CI. This file only supplies the real dependencies.
 *
 * `createClient()` is cast because its PostgREST builder is generic in ways the
 * narrow `ActionsClient` shape does not model; the methods used here (`from`,
 * `select`, `update`, `delete`, `eq`, `maybeSingle`) are the same ones
 * `verify:actions` exercises.
 */
export async function renameProject(
  projectId: string,
  rawTitle: string,
): Promise<ProjectActionResult> {
  const supabase = await createClient();
  return renameProjectWith(
    supabase as unknown as ActionsClient,
    projectId,
    rawTitle,
    revalidatePath,
  );
}

export async function deleteProject(projectId: string): Promise<ProjectActionResult> {
  const supabase = await createClient();
  return deleteProjectWith(supabase as unknown as ActionsClient, projectId, revalidatePath);
}
