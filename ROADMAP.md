# Roadmap — Synapse

Turn a recent research paper into a buildable coding project, honestly, for **$0**.

This file is the plan of record. It is user-facing and tracked in git, unlike the
engineering docs (`decision.md`, `Flow.md`, `learn.md`, `report.md`), which stay
local. Anything marked ✅ is verified in production, not "works on my machine".

**Live:** <https://synapse-seven-ebon.vercel.app>

---

## Where we are now — v1.3 · 2026-10-27

| Area | State |
|---|---|
| Paper discovery | **OpenAlex** (no key, source-filtered to arXiv) with the arXiv Atom API as the by-id fallback; one bounded 429 retry (D47, BUG-016) |
| Paper choice | **find one or bring your own** — paste an arXiv link/ID; the server extracts the id and re-fetches it; free shuffle, id-only handoff, no quota spent until you build (D41, D49) |
| Project ideas | **three tailored ideas before generation** for a paper you brought; free, separate 10/min limiter, no daily-quota spend (D49) |
| arXiv client | typed, retrying, backoff-aware; 429 retries once with `Retry-After`, other 4xx fail fast (BUG-010/016) |
| Generation | Gemini primary → Groq fallback, strict zod contract, one repair retry; a chosen idea is bounded prompt text, no schema change (BUG-011/012/013, D49) |
| Progress | **streamed** stages from the server: searching → reading (real paper title) → planning → saving (D39) |
| Workspace | roadmaps, ELI5 summary, prerequisites, roadmap/paper tabs, optimistic step tracking |
| Sharing | opt-in `/p/<slug>`, read-only, revocable, anon RLS policy, generated OG card (D30–D33, D42) |
| Gallery | **second opt-in** over shared rows, domain filter, no names, instant removal (D45) |
| Analytics | Web Analytics page views + Speed Insights field Core Web Vitals; funnel as `[event]` logs (custom events are Pro-only) (D46, D48) |
| Theming | **light/dark toggle** in the header; first visit follows the OS, choice persists, no flash (D50) |
| Export | Markdown download (progress for the owner, none for visitors) + print styles (D42) |
| Management | rename + delete, two-step confirm, papers survive delete (D40) |
| Safety | PPR-safe rendering everywhere (`connection()`), daily quota 10/user, per-instance rate limits, security headers, RLS as the boundary (D44) |
| CI | lint + **env-less** build + 10 offline specs, green on every push (D38) |
| Bugs | 16 logged, 15 fixed, 0 open (`report.md`) |

### What the last three phases taught us

Every bug that reached production was invisible in the browser and visible in
logs: a retired model id, a `Date.now()` during prerender, an aborted fetch that
looked like a missing row. That is why CI checks the *build* as much as the code,
and why `vercel logs` is part of the deploy loop (D37).

---

## Principles (these do not change)

1. **$0 hard cap.** Supabase free, Gemini/Groq free, Vercel Hobby. A feature that
   needs a paid tier does not ship.
2. **Never lie to the user.** Progress, errors and empty states reflect what the
   server actually did.
3. **The database is the security boundary.** RLS policies, not `.eq("user_id")`
   filters.
4. **If it only fails in production, it will fail in production.** Every fix gets
   a local before/after or an offline test.
5. **Small batches.** One phase = one demoable, revertible change.

---

## Shipped — v1.3 "Dark mode" · 2026-10-27

**Problem.** `app/globals.css` already had a full `.dark` palette, but nothing
ever put the `dark` class on `<html>`, so the app was permanently light.

**What shipped**
1. `next-themes` (already installed for the Toaster) wraps the app with
   `attribute="class"`, `defaultTheme="system"`, `enableSystem` and
   `disableTransitionOnChange`. Its inline script applies the saved theme before
   the first paint, so there is no light flash (D50).
2. A ghost `icon-sm` Sun/Moon toggle in the header and in the static header
   fallback. The icon swap is pure CSS (`dark:block` / `dark:hidden`), so the
   correct icon is painted immediately; the click reads the `<html>` class and
   calls `setTheme()`.
3. The Toaster moved inside the provider, so toasts follow the chosen theme. No
   migration, no new dependency, and no cookie read — the static shell/PPR is
   unchanged.

**Acceptance criteria**
- ✅ `lint`, `build` and all 10 offline specs pass.
- ✅ Server HTML contains the toggle + the next-themes inline script; built CSS
  contains `.dark`, `.dark\:block`, `.dark\:hidden`.
- ⏳ Signed-in visual click-through of both themes on production.

---

## Shipped — v1.2 "Bring your own paper" · 2026-10-27

**Problem.** Discovery was the only way in. If you already had a paper — from a
course, a lab, or a link a friend sent — Synapse ignored it. The pickers also
covered only the original eight domains and seven languages.

**What shipped**
1. A **Find a paper / I have a paper** toggle on the dashboard form. Paste an
   arXiv abstract/PDF link, an `arXiv:` id, or a bare id; the server extracts the
   id, validates it, and re-fetches through OpenAlex → arXiv. The browser never
   sends paper content (D41, D49).
2. **Three project ideas** tailored to the paper, language and level. Pick one,
   then `/api/generate` builds the roadmap around it. The ideas call is free and
   does not spend the 10/day generation quota; it has its own 10/min limiter.
3. The chosen idea travels as bounded prompt text (`projectIdea`, max 800
   chars), not a database column, so there is no migration. The roadmap's own
   title and summary persist what was built.
4. **10 more domains** (Time Series, Multimodal, AI Agents, Federated Learning,
   Causal Inference, Information Retrieval, 3D Vision, Video Understanding, AI
   for Science, Cybersecurity) and **5 more languages** (C#, Kotlin, Swift, R,
   Julia). Enum-only; no migration.
5. **Speed Insights** for field Core Web Vitals, next to Web Analytics. Preview
   now carries the same five keys as `.env.local` (`GEMINI_MODEL` is optional
   because the code defaults it) (D48).

**Acceptance criteria**
- ✅ `verify:ideas` (10th offline spec) covers URL/ID parsing, version and legacy
  ids, the ideas schema, dedupe, and the chosen-idea prompt.
- ✅ Live Gemini run: 3 ideas in ~7.9 s; the chosen idea produced a 6-step
  roadmap in ~28 s whose title matched the idea.
- ✅ `lint`, `build` and all 10 offline specs pass; `/api/ideas` is in the build
  manifest.
- ⏳ Signed-in click-through of the full UI (paste → ideas → build) on
  production; CI has no account.

---

## Shipped — v0.4 "You pick the paper" · 2026-10-26

**Problem.** Generation was a one-shot gamble. arXiv returns up to eight results,
`pickPaper()` silently chose one, and the user's only recovery from a bad choice
was to burn another of ten daily generations hoping for better. The paper *is*
the product; it should not be a lottery.

**What shipped**
1. `POST /api/papers` returns the top 3 candidates — title, category, date,
   author and a 280-character preview. Auth required; reading only.
2. The form is two steps: **find papers** → choose (or **shuffle**) → **build
   roadmap**. Shuffling re-posts with every id already shown as `exclude`.
3. "Try another paper" on a project links to `/dashboard` with the domain,
   language and level prefilled.
4. Nothing is written to `projects`, and no LLM is called, until a paper is
   chosen — shuffling is free.
5. The browser sends back only an `arxivId`; the server re-fetches the paper by
   id, so paper content can never be client-supplied. Malformed ids are rejected
   before any fetch.

**Acceptance criteria — verified**
- ✅ Choosing a paper writes exactly one project row (single insert path, still
  rolled back on step failure).
- ✅ Shuffling costs zero generations (the `/api/papers` route has no insert and
  no LLM call; quota counts `projects` rows only).
- ✅ The chosen paper's title reaches the stream (`reading` event), the DB and the
  project header.
- ✅ `verify:papers.mts` covers ranking, dedupe, exclusion, limit, preview
  trimming and id validation; CI runs it.
- ⏳ Live click-through by the signed-in owner (only a session can prove the full
  path — CI has no account).

---

## Shipped — v0.5 "Worth sharing" · 2026-10-26

| Item | State |
|---|---|
| **OG image for share links** (1200×630, `ImageResponse`) | ✅ generated per slug, never 500s, falls back to a generic card |
| **Export roadmap** — download Markdown, print stylesheet | ✅ owner export has progress; shared export does not; fences widen for backticks |
| **Error boundaries** — `error.tsx`, `not-found.tsx` | ✅ retry + reference digest; 404 does not reveal whether a link was revoked |
| **Landing page proof** — labelled example roadmap, honest cost line | ✅ week-one checklist removed |

Exit test: paste a share link into a chat app and it looks deliberate; download a
roadmap and open it in an editor without cleanup.

---

## Shipped — v0.6 "Hardened" · 2026-10-26

| Item | State |
|---|---|
| **Server-action rules extracted + tested** with a fake client (rename, delete, share) | ✅ `lib/project-ops.ts`, `verify:actions` — idempotent slug, RLS-filtered row, signed-out, migration hint |
| **Security headers / CSP** in `next.config.ts` | ✅ six headers; CSP limited to clickjacking/base/form/plugin (no fake `script-src`) |
| **Per-user rate limit** on both expensive routes | ✅ 30/min search, 6/min generate, `429` + `Retry-After`; honestly per-instance |
| **Timing instrumentation** | ✅ `[generate] timings { paperId, chosen, paperMs, llmMs, saveMs, totalMs }` |
| **Accessibility pass** | ✅ skip link, `id="main"`, `aria-busy`, `prefers-reduced-motion` |

Exit test: CI runs nine offline specs; headers visible on a real `next start`
response; the quota and limit paths return the documented status codes.

---

## Shipped — v1.1 "Discovery that doesn't get throttled" · 2026-10-27

| Item | State |
|---|---|
| **OpenAlex discovery** | ✅ `lib/openalex.ts`; `locations.source.id:S4306400194` + a six-month floor; domain-only relevance search; no key, 100k/day (D47) |
| **arXiv fallback** | ✅ a chosen paper is looked up through OpenAlex first, then `getArxivPaper(id)`; the id-only handoff is unchanged (D41) |
| **Honest 429 copy** | ✅ "rate-limiting … try again in about a minute" instead of "not responding"; one retry with `Retry-After`, other 4xx still fail fast (BUG-016) |
| **Regression coverage** | ✅ `verify:openalex` (9th offline spec) + amended `verify:arxiv:retry` |

Exit test: all eight domains return three candidates without calling
`export.arxiv.org`; a chosen paper resolves through OpenAlex; a stubbed 429
produces the rate-limit copy and exactly one retry.

---

## Shipped — v1.0 "Public" · 2026-10-26

| Item | State |
|---|---|
| **Public gallery** of shared roadmaps, second opt-in, filterable by domain | ✅ `/gallery`; `gallery_listed` flag + check constraint; owner toggles it in the share panel; revoking the link removes the card |
| **Moderation answer** | ✅ documented, not automated: no names/ids/profiles, narrow content surface, instant removal, manual report path — pre-review deliberately not claimed |
| **Analytics** | ✅ Web Analytics page views (`@vercel/analytics`); funnel as `[event]` lines because custom events are Pro-only; durable counts from SQL |
| **README with screenshots + 60-second demo** | ✅ `docs/screenshots/*`, demo section in `README.md` |

Exit test: `/gallery` lists only rows with a live slug **and** the flag; an
unlisted or revoked roadmap never appears; a missing 0003 shows instructions
instead of a 500.

> **Gallery switched on:** `0003_gallery.sql` was applied on 2026-10-26 and
> verified in production — `/gallery` renders its filter chips and empty state
> instead of the migration hint.

---

## Deliberately deferred

| Item | Why not yet |
|---|---|
| **Streaming roadmap content** (steps appearing as tokens arrive) | needs provider token streaming *and* partial-JSON parsing; the stage stream already removes the dead-air problem, so the cost/benefit is poor until the paper step exists |
| **Soft delete** (`deleted_at`) | every query, the quota count and the public policy would carry the filter forever; the free tier gains nothing |
| **Collections / tags / search on the dashboard** | useful at ~30 roadmaps, noise at ~10; revisit when a real user hits the wall |
| **A second LLM provider beyond two** | failover already covers a single provider outage; a third adds config surface, not reliability |
| **Payments / accounts beyond GitHub + magic link** | violates the $0 rule and adds nothing to the core loop |

---

## Backlog, one table

| ID | Item | Value | Effort | Phase |
|---|---|---|---|---|
| A1 | Paper preview + choose/shuffle | high | M | **done (v0.4)** |
| A2 | "Try another paper" from a project | high | S | **done (v0.4)** |
| B1 | OG image for share links | med | S | **done (v0.5)** |
| B2 | Export to Markdown / print | med | S | **done (v0.5)** |
| B3 | Error + not-found boundaries | med | S | **done (v0.5)** |
| B4 | Landing page proof section | med | M | **done (v0.5)** |
| C1 | Stage timing logs | med | S | **done (v0.6)** |
| C2 | Server-action tests | med | M | **done (v0.6)** |
| C3 | Security headers / CSP | low | S | **done (v0.6)** |
| C4 | Per-user rate limit (best-effort) | low | M | **done (v0.6)** |
| C5 | Accessibility + responsive pass | med | M | **done (v0.6)** |
| D1 | Public gallery (second opt-in, domain filter) | med | L | **done (v1.0)** |
| D2 | Analytics (page views + server funnel) | low | S | **done (v1.0)** |
| D3 | Screenshots / demo script | med | S | **done (v1.0)** |
| X1 | Streaming roadmap content | low (now) | L | deferred |

S = under an hour, M = an evening, L = a project.

---

## How we choose

1. Does it make the **core loop** (paper → roadmap) better? Those win.
2. Can it be verified without a paid service? If not, it waits.
3. Does it reduce free-tier spend or free-tier risk? Strong tiebreaker.
4. If two items tie, ship the smaller one — momentum compounds.
