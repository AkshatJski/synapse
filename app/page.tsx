import { ArrowRight, BookOpen, Check, Code2, Download, Layers, Lock, Share2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const flow = [
  {
    icon: Layers,
    title: "1 · Pick your lane",
    description:
      "Choose a domain (Computer Vision, NLP, RL…), a language (Python, TypeScript, Rust…) and your skill level.",
  },
  {
    icon: BookOpen,
    title: "2 · Choose the paper",
    description:
      "Three recent arXiv papers, with title, date, category and a short preview. Shuffle as often as you like — nothing is generated until you pick.",
  },
  {
    icon: Code2,
    title: "3 · Build something real",
    description:
      "The abstract becomes an ELI5 summary, prerequisite concepts, and ordered build steps with runnable code.",
  },
];

const extras = [
  { icon: Check, label: "Tick steps off as you build" },
  { icon: Download, label: "Export to Markdown or print" },
  { icon: Lock, label: "Private until you share it" },
  { icon: Share2, label: "Read-only public links" },
];

/** Hand-written sample, clearly labelled: no fake testimonials, no invented stats. */
const sampleSteps = [
  { title: "Build a minimal vision transformer", time: "2–3 h" },
  { title: "Train it on CIFAR-10", time: "3–4 h", done: true },
  { title: "Visualise where attention looks", time: "1–2 h" },
];

export default function HomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 py-20">
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Free tier only — arXiv · Supabase · Gemini
          </Badge>

          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Read the paper. Then actually build it.
          </h1>

          <p className="max-w-2xl text-lg text-muted-foreground text-pretty">
            Synapse turns a recent arXiv paper into a project roadmap you can ship this weekend.
            Pick the paper you want to build from, and get an ELI5 summary, prerequisites, and
            ordered steps with code.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" render={<Link href="/dashboard" />}>
              Generate a project
              <ArrowRight className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Free · no card · about ten seconds
            </span>
          </div>
        </div>

        <Card className="relative">
          <Badge variant="outline" className="absolute right-4 top-4 text-[0.65rem] uppercase tracking-wide">
            Example
          </Badge>
          <CardHeader>
            <CardDescription className="text-xs">Computer Vision · Python · Intermediate</CardDescription>
            <CardTitle className="text-lg leading-snug">Attention from scratch</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>1 of 3 steps done</span>
              <span>33%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 rounded-full bg-primary" />
            </div>

            <ol className="mt-1 flex flex-col gap-2">
              {sampleSteps.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                >
                  <span
                    className={
                      step.done
                        ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground"
                        : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
                    }
                  >
                    {step.done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className={step.done ? "text-muted-foreground line-through" : ""}>
                      {step.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{step.time}</span>
                  </span>
                </li>
              ))}
            </ol>

            <p className="text-xs text-muted-foreground">
              Illustrative output — your roadmap follows the paper you choose.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {flow.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="mb-2 size-5 text-muted-foreground" />
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">What you get</h2>
          <span className="text-xs text-muted-foreground">
            Runs on free tiers: arXiv, Supabase, Gemini. No ads, no tracking pixels.
          </span>
        </div>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          {extras.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="size-3.5 text-foreground" />
              {label}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
