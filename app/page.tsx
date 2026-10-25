import { ArrowRight, BookOpen, Code2, Layers } from "lucide-react";
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
    title: "2 · We find the paper",
    description:
      "Synapse queries the arXiv API for a recent, relevant paper and caches its metadata so repeat visits stay fast.",
  },
  {
    icon: Code2,
    title: "3 · Build something real",
    description:
      "An LLM translates the abstract into an ELI5 summary, prerequisites, and ordered steps with code you can run.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-20">
      <section className="flex flex-col items-start gap-6">
        <Badge variant="secondary" className="gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Free tier only — arXiv · Supabase · Groq / Gemini
        </Badge>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Read the paper. Then actually build it.
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground text-pretty">
          Synapse bridges academic research and practical engineering. Pick a domain, a language and a
          skill level — we find a recent arXiv paper and turn its dense abstract into a project roadmap
          you can ship this weekend.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" render={<Link href="/dashboard" />}>
            Generate a project
            <ArrowRight className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Free forever · arXiv · Supabase · Groq / Gemini
          </span>
        </div>
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

      <section className="rounded-xl border bg-muted/40 p-6">
        <h2 className="text-sm font-medium">Roadmap</h2>
        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li>✅ arXiv Atom client — typed, retried, unit-testable</li>
          <li>⬜ Supabase schema, RLS and OAuth</li>
          <li>⬜ LLM roadmap route with JSON-repair retry</li>
          <li>⬜ Project workspace with step tracking</li>
        </ul>
      </section>
    </main>
  );
}
