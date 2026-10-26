"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GENERATE_STAGES, type GenerateEvent, type GenerateStage } from "@/lib/generate-events";
import { readNdjson } from "@/lib/ndjson";
import { DOMAINS, LANGUAGES, SKILL_LEVELS, type SkillLevel } from "@/lib/roadmap";

const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: "Beginner — new to the domain",
  intermediate: "Intermediate — comfortable with the basics",
  advanced: "Advanced — production-minded",
};

/** Short text for the submit button while a stage is in flight. */
const BUTTON_LABELS: Record<GenerateStage, string> = {
  searching: "Searching arXiv…",
  reading: "Reading paper…",
  planning: "Planning steps…",
  saving: "Saving…",
};

/**
 * What the user reads, in the order the server actually does it.
 *
 * These are no longer guesses on a timer (D39): each line flips when the
 * matching `stage` event arrives from `/api/generate`.
 */
const STAGE_LABELS: Record<GenerateStage, string> = {
  searching: "Searching arXiv for a recent paper",
  reading: "Reading the abstract",
  planning: "Turning the abstract into build steps",
  saving: "Saving your roadmap",
};

export function GenerateForm() {
  const router = useRouter();

  const [domain, setDomain] = useState<string>(DOMAINS[0]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("beginner");
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<GenerateStage | null>(null);
  const [paperTitle, setPaperTitle] = useState<string | null>(null);

  function resetProgress() {
    setStage(null);
    setPaperTitle(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    resetProgress();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, language, skillLevel }),
      });

      // Everything that can be rejected up front (signed out, quota, bad input)
      // still answers with a status code and a JSON body.
      if (response.status === 401) {
        router.push("/login?next=/dashboard");
        return;
      }

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(payload.error ?? "Could not generate a project. Please try again.");
        setPending(false);
        resetProgress();
        return;
      }

      // From here on the body is NDJSON: one event per line, in order.
      let settled = false;

      try {
        for await (const event of readNdjson<GenerateEvent>(response.body)) {
          if (event.type === "stage") {
            setStage(event.stage);
            if (event.paper) setPaperTitle(event.paper.title);
            continue;
          }

          if (event.type === "error") {
            toast.error(event.message);
            setPending(false);
            resetProgress();
            settled = true;
            break;
          }

          if (event.type === "done") {
            settled = true;
            toast.success("Roadmap ready.");
            router.push(`/project/${event.projectId}`);
            break;
          }
        }
      } catch (streamError) {
        console.error("[generate] progress stream failed", streamError);
        toast.error("The progress stream broke before the roadmap was saved. Please try again.");
        setPending(false);
        resetProgress();
        return;
      }

      if (!settled) {
        // The stream ended without `done` or `error` — proxy timeout, dropped
        // connection, or the tab slept. Do not leave the button spinning.
        toast.error("The connection ended before the roadmap was ready. Please try again.");
        setPending(false);
        resetProgress();
      }
    } catch {
      toast.error("Network error — check your connection and try again.");
      setPending(false);
      resetProgress();
    }
  }

  const activeIndex = stage ? GENERATE_STAGES.indexOf(stage) : -1;

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="domain">Domain</Label>
              <Select value={domain} onValueChange={(value) => setDomain(value as string)}>
                <SelectTrigger id="domain" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOMAINS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={(value) => setLanguage(value as string)}>
                <SelectTrigger id="language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skill">Skill level</Label>
              <Select
                value={skillLevel}
                onValueChange={(value) => setSkillLevel(value as SkillLevel)}
              >
                <SelectTrigger id="skill" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_LEVELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SKILL_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              {pending ? (stage ? BUTTON_LABELS[stage] : "Starting…") : "Generate project"}
            </Button>
            <span className="text-sm text-muted-foreground">
              One paper, one roadmap. Takes 5–15 seconds.
            </span>
          </div>
        </form>

        {pending && (
          <div className="mt-6 flex flex-col gap-4" role="status" aria-live="polite">
            <ol className="flex flex-col gap-2">
              {GENERATE_STAGES.map((id, index) => {
                const state =
                  index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
                const label =
                  id === "reading" && paperTitle && state !== "todo"
                    ? `Reading “${paperTitle}”`
                    : STAGE_LABELS[id];

                return (
                  <li
                    key={id}
                    className={
                      state === "todo"
                        ? "flex items-center gap-2 text-sm text-muted-foreground/60"
                        : state === "active"
                          ? "flex items-center gap-2 text-sm font-medium"
                          : "flex items-center gap-2 text-sm text-muted-foreground"
                    }
                  >
                    {state === "done" && <Check className="size-4 shrink-0 text-primary" />}
                    {state === "active" && (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    )}
                    {state === "todo" && <Circle className="size-4 shrink-0" />}
                    <span className="line-clamp-1">{label}</span>
                  </li>
                );
              })}
            </ol>

            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex flex-col gap-2 rounded-lg border p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
