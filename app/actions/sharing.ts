"use server";

import { revalidatePath } from "next/cache";

import {
  disableSharingWith,
  enableSharingWith,
  type ActionsClient,
  type ShareResult,
} from "@/lib/project-ops";
import { createClient } from "@/lib/supabase/server";

export type { ShareResult };

/** Rules live in `lib/project-ops.ts`; this file supplies the real client. */
export async function enableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  return enableSharingWith(supabase as unknown as ActionsClient, projectId, revalidatePath);
}

export async function disableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  return disableSharingWith(supabase as unknown as ActionsClient, projectId, revalidatePath);
}
