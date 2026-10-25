"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
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
import { DOMAINS, LANGUAGES, SKILL_LEVELS, type SkillLevel } from "@/lib/roadmap";

const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: "Beginner — new to the domain",
  intermediate: "Intermediate — comfortable with the basics",
  advanced: "Advanced — production-minded",
};

const PROGRESS_MESSAGES = [
  "Searching arXiv for a recent paper…",
  "Reading the abstract…",
  "Translating research into build steps…",
  "Writing code snippets in your language…",
  "Saving your roadmap…",
];

export function GenerateForm() {
  const router = useRouter();

  const [domain, setDomain] = useState<string>(DOMAINS[0]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("beginner");
  const [pending, setPending] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  // The LLM takes 5-15s; a moving status line is the difference between "broken"
  // and "working".
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setMessageIndex((index) => Math.min(index + 1, PROGRESS_MESSAGES.length - 1));
    }, 2800);
    return () => clearInterval(timer);
  }, [pending]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setMessageIndex(0);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, language, skillLevel }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        projectId?: string;
        error?: string;
        code?: string;
      };

      if (response.status === 401) {
        router.push("/login?next=/dashboard");
        return;
      }

      if (!response.ok || !payload.projectId) {
        toast.error(payload.error ?? "Could not generate a project. Please try again.");
        setPending(false);
        return;
      }

      toast.success("Roadmap ready.");
      router.push(`/project/${payload.projectId}`);
    } catch {
      toast.error("Network error — check your connection and try again.");
      setPending(false);
    }
  }

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
              {pending ? "Generating…" : "Generate project"}
            </Button>
            <span className="text-sm text-muted-foreground">
              One paper, one roadmap. Takes 5–15 seconds.
            </span>
          </div>
        </form>

        {pending && (
          <div className="mt-6 flex flex-col gap-4" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 animate-pulse text-primary" />
              {PROGRESS_MESSAGES[messageIndex]}
            </p>

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
