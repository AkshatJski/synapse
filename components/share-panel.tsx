"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Globe, LayoutGrid, Link2, Lock, X } from "lucide-react";
import { toast } from "sonner";

import { disableSharing, enableSharing, setGalleryListing } from "@/app/actions/sharing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SharePanelProps {
  projectId: string;
  initialSlug: string | null;
  /** Absolute origin, resolved on the server so the client never guesses. */
  origin: string;
  /** False when the 0002 migration has not been applied yet. */
  sharingReady: boolean;
  /** False when the 0003 migration has not been applied yet. */
  galleryReady: boolean;
  /** Current second opt-in: listed in `/gallery` in addition to being shared. */
  initialListed: boolean;
}

/**
 * Opt-in public link for a roadmap.
 *
 * Sharing is off by default and reversible: the slug is discarded on revoke, so
 * a re-share mints a new URL instead of resurrecting an old one.
 */
export function SharePanel({
  projectId,
  initialSlug,
  origin,
  sharingReady,
  galleryReady,
  initialListed,
}: SharePanelProps) {
  const [slug, setSlug] = useState(initialSlug);
  const [listed, setListed] = useState(initialListed);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!sharingReady) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" />
        <p>
          Public links are not available yet. Run{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">supabase/migrations/0002_sharing.sql</code>{" "}
          in the Supabase SQL editor to enable them.
        </p>
      </div>
    );
  }

  const shareUrl = slug ? `${origin}/p/${slug}` : "";

  function handleCreate() {
    startTransition(async () => {
      const result = await enableSharing(projectId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not create a share link.");
        return;
      }
      setSlug(result.slug ?? null);
      toast.success("Public link created.");
    });
  }

  function handleRevoke() {
    const confirmed = window.confirm(
      "Stop sharing this roadmap? The link will stop working immediately and a new link will be created if you share it again.",
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await disableSharing(projectId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not stop sharing.");
        return;
      }
      setSlug(null);
      setListed(false);
      setCopied(false);
      toast.success("Sharing stopped.");
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.");
    }
  }

  function handleGalleryToggle(next: boolean) {
    startTransition(async () => {
      const result = await setGalleryListing(projectId, next);
      if (!result.ok) {
        toast.error(result.error ?? "Could not change the gallery listing.");
        return;
      }
      setListed(next);
      toast.success(next ? "Listed in the gallery." : "Removed from the gallery.");
    });
  }

  if (!slug) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">This roadmap is private</p>
            <p className="text-sm text-muted-foreground">
              Only you can see it. Create a public link to share a read-only copy — no account
              needed to read it.
            </p>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={handleCreate}
          disabled={pending}
          className="shrink-0 self-start sm:self-auto"
        >
          <Link2 className="size-4" />
          {pending ? "Creating…" : "Create public link"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Anyone with this link can read it</p>
          <p className="text-sm text-muted-foreground">
            Read-only. Visitors cannot edit steps, and they never see your account or other
            roadmaps.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          readOnly
          value={shareUrl}
          aria-label="Public share link"
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            render={<a href={shareUrl} target="_blank" rel="noreferrer noopener" />}
          >
            <ExternalLink className="size-4" />
            Open
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRevoke}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="size-4" />
            Stop sharing
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
        <input
          id={`gallery-${projectId}`}
          type="checkbox"
          checked={listed}
          disabled={pending || !galleryReady}
          onChange={(event) => handleGalleryToggle(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <label htmlFor={`gallery-${projectId}`} className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            List in the public gallery
          </span>
          <span className="text-xs text-muted-foreground">
            {galleryReady
              ? "Anyone can browse the title, domain and steps. Your name and other roadmaps stay private, and unticking removes it immediately."
              : "The gallery needs the 0003_gallery.sql migration. Run it in the Supabase SQL editor to enable this."}
          </span>
        </label>
      </div>
    </div>
  );
}
