"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface ToggleStepResult {
  ok: boolean;
  error?: string;
}

/**
 * Marks a step complete/incomplete.
 *
 * Ownership is enforced twice: RLS on `steps` (via the parent project) and an
 * explicit filter on the row id. A client can pass any id it likes and still
 * only ever touch its own rows.
 */
export async function toggleStep(stepId: string, isCompleted: boolean): Promise<ToggleStepResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You are signed out. Refresh the page and sign in again." };
  }

  const { data, error } = await supabase
    .from("steps")
    .update({ is_completed: isCompleted })
    .eq("id", stepId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[toggleStep] update failed", error);
    return { ok: false, error: "Could not save that change." };
  }

  if (!data) {
    return { ok: false, error: "That step does not exist, or it is not yours." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
