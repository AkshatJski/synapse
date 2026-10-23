# Synapse

**Read the paper. Then actually build it.**

Synapse bridges academic research and practical engineering. Pick a domain, a
language and a skill level — Synapse finds a recent arXiv paper and turns its
dense abstract into a step-by-step project roadmap you can actually ship.

> Built entirely on free tiers: **arXiv** (papers) · **Supabase** (Postgres, auth,
> RLS) · **Groq / Gemini** (LLM) · **Vercel** (hosting). No paid APIs.

---

## What it does

1. **Choose** a domain (Computer Vision, NLP, RL…), a language (Python,
   TypeScript, Rust…) and a skill level (Beginner / Intermediate / Advanced).
2. **Search** — Synapse queries the arXiv Atom API for a relevant recent paper
   and caches its metadata.
3. **Generate** — an LLM translates the abstract into an ELI5 summary,
   prerequisite concepts, and ordered build steps with code.
4. **Build** — work through the roadmap, ticking steps off as you go.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Turbopack) |
| Language | TypeScript (strict) |
| UI | Tailwind CSS v4, shadcn/ui (`base-nova`), lucide-react, sonner |
| Data | arXiv Atom API (`fast-xml-parser`) |
| Database / auth | Supabase (Postgres + RLS, GitHub OAuth + email) |
| AI | Groq (Llama 3.3 70B) or Google Gemini — free tier |
| Markdown | react-markdown + rehype-highlight |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open <http://localhost:3000>.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build + type check |
| `npm run lint` | ESLint |
| `npm run verify:arxiv` | Smoke-test `lib/arxiv.ts` against the live arXiv API |

## Project layout

```
app/
  layout.tsx        root layout, metadata, toaster
  page.tsx          landing page (RSC)
  globals.css       Tailwind v4 theme + shadcn tokens
lib/
  arxiv.ts          typed arXiv Atom client (search + parse)
  utils.ts          cn() helper
components/ui/      shadcn primitives
scripts/
  verify-arxiv.mts  live smoke check
```

## Notes on this version

This repo is built on **Next.js 16**, which differs from most tutorials:

- Turbopack is the default for `dev` and `build`.
- `cookies()`, `headers()`, `params`, `searchParams` are **async**.
- `middleware.ts` is now `proxy.ts` (export `proxy`).
- `revalidateTag(tag, profile)` takes two arguments.

Version-matched docs ship inside the package: `node_modules/next/dist/docs/`.

## Roadmap

- [x] Next.js + Tailwind + shadcn scaffold
- [x] Typed arXiv client with retry/backoff
- [ ] Supabase schema, RLS, GitHub OAuth + email login
- [ ] `/api/generate` — LLM roadmap with strict JSON validation + repair retry
- [ ] Project workspace with step tracking
- [ ] Public project sharing

## License

MIT
