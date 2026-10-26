"use client";

import { useState, useTransition } from "react";
import { Check, Clock } from "lucide-react";
import { toast } from "sonner";

import { toggleStep } from "@/app/actions/steps";
import { MarkdownContent } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import type { StepRow } from "@/lib/types";

interface StepsListProps {
  steps: StepRow[];
  language: string;
  /**
   * Renders the roadmap without any interaction. Used by the public share page:
   * a visitor is not the owner, so there is nothing to toggle and no progress to
   * claim (their view of `is_completed` would belong to someone else anyway).
   */
  readOnly?: boolean;
}

/**
 * The interactive half of the roadmap.
 *
 * Toggling is optimistic: the checkbox flips immediately, the server action runs
 * in a transition, and a failure rolls the UI back and explains why. On a free
 * tier the round trip is the slow part, so waiting for it would feel broken.
 */
export function StepsList({ steps, language, readOnly = false }: StepsListProps) {
  const [completed, setCompleted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(steps.map((step) => [step.id, step.is_completed])),
  );
  const [, startTransition] = useTransition();

  const done = steps.filter((step) => completed[step.id]).length;
  const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
  function handleToggle(step: StepRow) {
    const next = !completed[step.id];
    setCompleted((previous) => ({ ...previous, [step.id]: next }));

    startTransition(async () => {
      const result = await toggleStep(step.id, next);
      if (!result.ok) {
        setCompleted((previous) => ({ ...previous, [step.id]: !next }));
        toast.error(result.error ?? "Could not save that change.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {!readOnly && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {done} of {steps.length} steps complete
            </span>
            <span className="text-muted-foreground">{percent}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-4">
        {steps.map((step, index) => {
          const isDone = !readOnly && completed[step.id];

          return (
            <li
              key={step.id}
              className="rounded-xl border bg-card p-4 transition-colors data-[done=true]:bg-muted/40 print:break-inside-avoid"
              data-done={isDone}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium data-[done=true]:border-primary data-[done=true]:bg-primary data-[done=true]:text-primary-foreground"
                  data-done={isDone}
                >
                  {isDone ? <Check className="size-3.5" /> : index + 1}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className="text-sm font-semibold data-[done=true]:text-muted-foreground data-[done=true]:line-through"
                      data-done={isDone}
                    >
                      {step.title}
                    </h3>
                    {step.estimated_time && (
                      <Badge variant="outline" className="gap-1 text-[0.7rem]">
                        <Clock className="size-3" />
                        {step.estimated_time}
                      </Badge>
                    )}
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <MarkdownContent content={step.description} />
                  </div>

                  {step.code_snippet && (
                    <MarkdownContent content={step.code_snippet} language={language} code />
                  )}
                </div>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleToggle(step)}
                    aria-pressed={isDone}
                    aria-label={
                      isDone ? `Mark "${step.title}" incomplete` : `Mark "${step.title}" complete`
                    }
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[done=true]:border-primary data-[done=true]:bg-primary data-[done=true]:text-primary-foreground"
                    data-done={isDone}
                  >
                    {isDone ? <Check className="size-4" /> : <span className="size-4" aria-hidden />}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
