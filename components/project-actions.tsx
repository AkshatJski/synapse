"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteProject, renameProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProjectActionsProps {
  projectId: string;
  title: string;
  /**
   * Dashboard cards: icon-only controls that stay put after deleting.
   * Otherwise (the workspace page): labelled controls that navigate away.
   */
  compact?: boolean;
}

/**
 * Rename and delete, in place.
 *
 * Both are two-step on purpose — rename opens an input, delete opens a
 * confirmation bar. There is no undo for either (renaming over a title is the
 * only reversible one), so neither should be a single accidental click.
 */
export function ProjectActions({ projectId, title, compact = false }: ProjectActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [draft, setDraft] = useState(title);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode("idle");
    setDraft(title);
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const result = await renameProject(projectId, draft);
      if (!result.ok) {
        toast.error(result.error ?? "Could not rename that roadmap.");
        return;
      }
      setMode("idle");
      toast.success("Roadmap renamed.");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProject(projectId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete that roadmap.");
        return;
      }
      toast.success("Roadmap deleted.");
      setMode("idle");

      // The page we are on no longer exists, so replace it instead of pushing.
      if (compact) {
        router.refresh();
      } else {
        router.replace("/dashboard");
      }
    });
  }

  if (mode === "rename") {
    return (
      <form onSubmit={handleRename} className="flex w-full flex-col gap-2 sm:w-auto">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={120}
          autoFocus
          aria-label="Roadmap title"
          className="h-8 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Escape") reset();
          }}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (mode === "delete") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2">
        <p className="text-xs text-muted-foreground">
          Delete <span className="font-medium text-foreground">{title}</span> permanently? Its steps
          and public link go with it. This cannot be undone.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Delete
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setMode("rename")}
        aria-label="Rename roadmap"
        title="Rename"
      >
        <Pencil className="size-3.5" />
        {!compact && "Rename"}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setMode("delete")}
        aria-label="Delete roadmap"
        title="Delete"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        {!compact && "Delete"}
      </Button>
    </div>
  );
}
