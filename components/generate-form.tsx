"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Circle,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { formatIdea, type ProjectIdea } from "@/lib/ideas";
import { readNdjson } from "@/lib/ndjson";
import type { PaperCandidate } from "@/lib/papers";
import {
  DOMAINS,
  LANGUAGES,
  SKILL_LEVELS,
  type Domain,
  type Language,
  type SkillLevel,
} from "@/lib/roadmap";

const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: "Beginner — new to the domain",
  intermediate: "Intermediate — comfortable with the basics",
  advanced: "Advanced — production-minded",
};

/** Short text for the submit button while a stage is in flight. */
/**
 * What the user reads, in the order the server actually does it.
 *
 * These are no longer guesses on a timer (D39): each line flips when the
 * matching `stage` event arrives from `/api/generate`. When the user picked a
 * paper there is no search, so the list starts at the first stage the server
 * announced rather than showing a step that never happens (D41).
 */
const STAGE_LABELS: Record<GenerateStage, string> = {
  searching: "Searching arXiv for a recent paper",
  reading: "Reading the abstract",
  planning: "Turning the abstract into build steps",
  saving: "Saving your roadmap",
};

type Phase = "form" | "papers" | "generating";

type Mode = "search" | "own";

type Busy = "find" | "shuffle" | "lookup" | "ideas" | null;

type CandidatesResponse = { candidates: PaperCandidate[]; exhausted: boolean };

/** Two-way source switch, styled like a small segmented control. */
function tabClass(active: boolean): string {
  return `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;
}

type GenerateFormProps = {
  /** Prefill from `/dashboard?domain=…&language=…&skill=…` (project page). */
  initialDomain?: string;
  initialLanguage?: string;
  initialSkill?: string;
};

const publishedFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
});

function oneOf<T extends readonly string[]>(
  options: T,
  value: string | undefined,
  fallback: T[number],
): T[number] {
  return value && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function describeCandidate(candidate: PaperCandidate): string {
  const parts: string[] = [];
  if (candidate.primaryCategory) parts.push(candidate.primaryCategory);
  if (candidate.publishedDate) {
    const parsed = new Date(candidate.publishedDate);
    if (!Number.isNaN(parsed.getTime())) parts.push(publishedFormatter.format(parsed));
  }
  if (candidate.authors.length > 0) {
    parts.push(
      candidate.authors.length > 1 ? `${candidate.authors[0]} et al.` : candidate.authors[0],
    );
  }
  return parts.join(" · ");
}

export function GenerateForm({
  initialDomain,
  initialLanguage,
  initialSkill,
}: GenerateFormProps = {}) {
  const router = useRouter();

  const [domain, setDomain] = useState<Domain>(() => oneOf(DOMAINS, initialDomain, DOMAINS[0]));
  const [language, setLanguage] = useState<Language>(() =>
    oneOf(LANGUAGES, initialLanguage, LANGUAGES[0]),
  );
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(() =>
    oneOf(SKILL_LEVELS, initialSkill, "beginner"),
  );

  const [mode, setMode] = useState<Mode>("search");
  const [phase, setPhase] = useState<Phase>("form");
  const [busy, setBusy] = useState<Busy>(null);
  const [paperInput, setPaperInput] = useState("");
  const [candidates, setCandidates] = useState<PaperCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Ids already shown, so "shuffle" returns different papers. */
  const [seen, setSeen] = useState<string[]>([]);
  /** Null until the user asks; an empty array is a successful but empty answer. */
  const [ideas, setIdeas] = useState<ProjectIdea[] | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<number | null>(null);

  const [stage, setStage] = useState<GenerateStage | null>(null);
  // null until the first stage event: the list is sliced from that stage, so a
  // chosen paper shows reading → planning → saving and never a phantom search.
  const [stageList, setStageList] = useState<GenerateStage[] | null>(null);
  const [paperTitle, setPaperTitle] = useState<string | null>(null);

  const generating = phase === "generating";

  function resetProgress() {
    setStage(null);
    setStageList(null);
    setPaperTitle(null);
  }

  function applyCandidates(next: PaperCandidate[]) {
    setCandidates(next);
    setSelectedId(next[0]?.arxivId ?? null);
    setSeen((current) => [...current, ...next.map((candidate) => candidate.arxivId)]);
    setIdeas(null);
    setSelectedIdea(null);
  }

  async function requestCandidates(exclude: string[]): Promise<CandidatesResponse | null> {
    const response = await fetch("/api/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, language, exclude }),
    });

    if (response.status === 401) {
      router.push("/login?next=/dashboard");
      return null;
    }

    const payload = (await response.json().catch(() => ({}))) as Partial<CandidatesResponse> & {
      error?: string;
    };

    if (!response.ok || !payload.candidates) {
      toast.error(payload.error ?? "Could not reach arXiv. Please try again.");
      return null;
    }

    return { candidates: payload.candidates, exhausted: payload.exhausted ?? false };
  }

  async function requestPaper(paperId: string): Promise<CandidatesResponse | null> {
    const response = await fetch("/api/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId }),
    });

    if (response.status === 401) {
      router.push("/login?next=/dashboard");
      return null;
    }

    const payload = (await response.json().catch(() => ({}))) as Partial<CandidatesResponse> & {
      error?: string;
    };

    if (!response.ok || !payload.candidates) {
      toast.error(payload.error ?? "Could not load that paper. Check the link or id.");
      return null;
    }

    return { candidates: payload.candidates, exhausted: false };
  }

  async function handleLoadPaper(event: FormEvent) {
    event.preventDefault();
    if (busy || generating) return;

    if (!paperInput.trim()) {
      toast.error("Paste an arXiv link or id first.");
      return;
    }

    setBusy("lookup");
    try {
      const result = await requestPaper(paperInput);
      if (!result) return;

      if (result.candidates.length === 0) {
        toast.error("We could not find that paper on arXiv. Check the link or id.");
        return;
      }

      setSeen([]);
      applyCandidates(result.candidates);
      setPhase("papers");
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleIdeas() {
    if (!selectedId || busy || generating) return;

    setBusy("ideas");
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, language, skillLevel, paperId: selectedId }),
      });

      if (response.status === 401) {
        router.push("/login?next=/dashboard");
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        ideas?: ProjectIdea[];
        error?: string;
      };

      if (!response.ok || !payload.ideas) {
        toast.error(payload.error ?? "Could not propose projects for this paper. Try again.");
        return;
      }

      if (payload.ideas.length === 0) {
        toast.error("No project ideas came back for this paper. Try again.");
        return;
      }

      setIdeas(payload.ideas);
      setSelectedIdea(payload.ideas.length > 0 ? 0 : null);
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleFindPapers(event: FormEvent) {
    event.preventDefault();
    if (busy || generating) return;

    setBusy("find");
    try {
      const result = await requestCandidates([]);
      if (!result) return;

      if (result.candidates.length === 0) {
        toast.error("No arXiv paper matched that combination. Try a broader domain.");
        return;
      }

      setSeen([]);
      applyCandidates(result.candidates);
      setPhase("papers");
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleShuffle() {
    if (busy || generating) return;

    setBusy("shuffle");
    try {
      const result = await requestCandidates(seen);
      if (!result) return;

      if (result.candidates.length === 0) {
        toast.error(
          result.exhausted
            ? "You have seen every paper arXiv returned for this combination. Try a different domain."
            : "arXiv has no more papers for this combination. Try a different domain.",
        );
        return;
      }

      applyCandidates(result.candidates);
      toast.success("Here are three other papers.");
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function handleChangeOptions() {
    if (generating) return;
    setPhase("form");
    setCandidates([]);
    setSelectedId(null);
    setSeen([]);
    setIdeas(null);
    setSelectedIdea(null);
    resetProgress();
  }

  function switchMode(next: Mode) {
    if (generating || next === mode) return;
    setMode(next);
    handleChangeOptions();
  }

  async function handleGenerate() {
    if (!selectedId || generating) return;

    const chosenIdea = ideas && selectedIdea !== null ? ideas[selectedIdea] : null;
    // Once ideas are on screen, "Build" means one of them, not a silent fallback.
    if (mode === "own" && ideas !== null && !chosenIdea) return;

    setPhase("generating");
    resetProgress();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          language,
          skillLevel,
          paperId: selectedId,
          ...(chosenIdea ? { projectIdea: formatIdea(chosenIdea) } : {}),
        }),
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
        setPhase("papers");
        resetProgress();
        return;
      }

      // From here on the body is NDJSON: one event per line, in order.
      let settled = false;

      try {
        for await (const event of readNdjson<GenerateEvent>(response.body)) {
          if (event.type === "stage") {
            setStage(event.stage);
            setStageList((current) =>
              current ?? GENERATE_STAGES.slice(GENERATE_STAGES.indexOf(event.stage)),
            );
            if (event.paper) setPaperTitle(event.paper.title);
            continue;
          }

          if (event.type === "error") {
            toast.error(event.message);
            setPhase("papers");
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
        setPhase("papers");
        resetProgress();
        return;
      }

      if (!settled) {
        // The stream ended without `done` or `error` — proxy timeout, dropped
        // connection, or the tab slept. Do not leave the button spinning.
        toast.error("The connection ended before the roadmap was ready. Please try again.");
        setPhase("papers");
        resetProgress();
      }
    } catch {
      toast.error("Network error — check your connection and try again.");
      setPhase("papers");
      resetProgress();
    }
  }

  const stages = stageList ?? GENERATE_STAGES;
  const activeIndex = stage ? stages.indexOf(stage) : -1;

  return (
    <Card>
      <CardContent className="pt-6">
        {phase === "form" && (
          <form
            onSubmit={mode === "search" ? handleFindPapers : handleLoadPaper}
            className="flex flex-col gap-5"
          >
            <div
              className="flex w-full rounded-lg border p-1"
              role="tablist"
              aria-label="Where should the paper come from?"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "search"}
                className={tabClass(mode === "search")}
                onClick={() => switchMode("search")}
                disabled={busy !== null}
              >
                <Search className="size-4" />
                Find a paper
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "own"}
                className={tabClass(mode === "own")}
                onClick={() => switchMode("own")}
                disabled={busy !== null}
              >
                <FileText className="size-4" />
                I have a paper
              </button>
            </div>

            {mode === "own" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="paper-id">arXiv link or ID</Label>
                <Input
                  id="paper-id"
                  value={paperInput}
                  onChange={(event) => setPaperInput(event.target.value)}
                  placeholder="https://arxiv.org/abs/1706.03762"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy !== null}
                />
                <p className="text-xs text-muted-foreground">
                  Paste an abstract link or the bare id, e.g. 1706.03762.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="domain">Domain</Label>
                <Select value={domain} onValueChange={(value) => setDomain(value as Domain)}>
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
                <Select
                  value={language}
                  onValueChange={(value) => setLanguage(value as Language)}
                >
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
              <Button
                type="submit"
                size="lg"
                disabled={busy !== null || (mode === "own" && paperInput.trim().length === 0)}
              >
                {busy === "find" || busy === "lookup" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : mode === "own" ? (
                  <FileText className="size-4" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                {mode === "own"
                  ? busy === "lookup"
                    ? "Loading paper…"
                    : "Load paper"
                  : busy === "find"
                    ? "Finding papers…"
                    : "Find papers"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {mode === "own"
                  ? "You'll see three projects you can build before anything is generated."
                  : "Free. You choose from three real papers before anything is generated."}
              </span>
            </div>
          </form>
        )}

        {phase === "papers" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {mode === "own" ? "Your paper" : "Choose a paper"}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {domain}, {language}, {skillLevel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleChangeOptions}
                  disabled={busy !== null}
                >
                  <ArrowLeft className="size-3.5" />
                  {mode === "own" ? "Change paper" : "Change options"}
                </Button>
                {mode === "search" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShuffle}
                    disabled={busy !== null}
                  >
                    {busy === "shuffle" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Shuffle
                  </Button>
                )}
              </div>
            </div>

            <fieldset className="flex flex-col gap-3" disabled={busy !== null}>
              <legend className="sr-only">Paper candidates</legend>
              {candidates.map((candidate) => {
                const selected = candidate.arxivId === selectedId;
                const meta = describeCandidate(candidate);

                return (
                  <label
                    key={candidate.arxivId}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                      selected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="paper"
                      value={candidate.arxivId}
                      checked={selected}
                      onChange={() => setSelectedId(candidate.arxivId)}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium leading-snug">{candidate.title}</span>
                      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {candidate.abstractPreview}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {mode === "own" && ideas === null && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleIdeas}
                  disabled={!selectedId || busy !== null}
                >
                  {busy === "ideas" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Lightbulb className="size-4" />
                  )}
                  {busy === "ideas" ? "Finding projects…" : "See what you can build"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  Three project ideas tailored to this paper. Free.
                </span>
              </div>
            )}

            {mode === "own" && ideas !== null && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Pick a project</p>
                  <p className="text-sm text-muted-foreground">
                    You’ll get a full roadmap for the one you choose.
                  </p>
                </div>
                <fieldset className="flex flex-col gap-3" disabled={busy !== null}>
                  <legend className="sr-only">Project ideas</legend>
                  {ideas.map((idea, index) => {
                    const selected = selectedIdea === index;

                    return (
                      <label
                        key={`${idea.title}-${index}`}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                          selected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="idea"
                          value={index}
                          checked={selected}
                          onChange={() => setSelectedIdea(index)}
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span className="flex flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium leading-snug">{idea.title}</span>
                            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                              {idea.difficulty}
                            </span>
                          </span>
                          <span className="text-sm text-muted-foreground">{idea.pitch}</span>
                          <span className="text-xs text-muted-foreground">
                            You’ll build: {idea.build}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={handleGenerate}
                disabled={
                  !selectedId ||
                  busy !== null ||
                  (mode === "own" && ideas !== null && selectedIdea === null)
                }
              >
                <Wand2 className="size-4" />
                {mode === "own" && ideas !== null ? "Build this project" : "Build this roadmap"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {mode === "own"
                  ? ideas !== null
                    ? "One generation credit for the project you picked."
                    : "You can build directly, or see three project ideas first."
                  : "Shuffling is free — it only costs you a generation when you build."}
              </span>
            </div>
          </div>
        )}

        {generating && (
          <div className="flex flex-col gap-5" role="status" aria-live="polite" aria-busy="true">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Building your roadmap</p>
              <p className="text-sm text-muted-foreground">
                {domain}, {language}, {skillLevel}
              </p>
            </div>

            <ol className="flex flex-col gap-2">
              {stages.map((id, index) => {
                const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
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
