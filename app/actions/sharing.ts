"use server";

import { revalidatePath } from "next/cache";

import { logEvent } from "@/lib/events";
import {
  disableSharingWith,
  enableSharingWith,
  setGalleryListingWith,
  type ActionsClient,
  type ShareResult,
} from "@/lib/project-ops";
import { createClient } from "@/lib/supabase/server";

export type { ShareResult };

/** Rules live in `lib/project-ops.ts`; this file supplies the real client. */
export async function enableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  const result = await enableSharingWith(
    supabase as unknown as ActionsClient,
    projectId,
    revalidatePath,
  );

  if (result.ok) logEvent("share_created", { projectId });
  return result;
}

export async function disableSharing(projectId: string): Promise<ShareResult> {
  const supabase = await createClient();
  const result = await disableSharingWith(
    supabase as unknown as ActionsClient,
    projectId,
    revalidatePath,
  );

  if (result.ok) logEvent("share_revoked", { projectId });
  return result;
}

export async function setGalleryListing(
  projectId: string,
  listed: boolean,
): Promise<ShareResult> {
  const supabase = await createClient();
  const result = await setGalleryListingWith(
    supabase as unknown as ActionsClient,
    projectId,
    listed,
    revalidatePath,
  );

  if (result.ok) {
    logEvent(listed ? "gallery_listed" : "gallery_unlisted", { projectId });
  }
  return result;
}
