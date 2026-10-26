# Roadmap — Synapse

Turn a recent research paper into a buildable coding project, honestly, for **$0**.

This file is the plan of record. It is user-facing and tracked in git, unlike the
engineering docs (`decision.md`, `Flow.md`, `learn.md`, `report.md`), which stay
local. Anything marked ✅ is verified in production, not "works on my machine".

**Live:** <https://synapse-seven-ebon.vercel.app>

---

## Where we are now — v0.3 · 2026-10-26

| Area | State |
|---|---|
| arXiv client | typed, retrying, backoff-aware, refuses to retry a 4xx (BUG-010) |
| Generation | Gemini primary → Groq fallback, strict zod contract, one repair retry (BUG-011/012/013) |
| Progress | **streamed** stages from the server: searching → reading (real paper title) → planning → saving (D39) |
| Workspace | roadmaps, ELI5 summary, prerequisites, roadmap/paper tabs, optimistic step tracking |
| Sharing | opt-in `/p/<slug>`, read-only, revocable, anon RLS policy (D30–D33) |
| Management | rename + delete, two-step confirm, papers survive delete (D40) |
| Safety | PPR-safe rendering everywhere (`connection()`), daily quota 10/user, RLS as the boundary |
| CI | lint + **env-less** build + 5 offline specs, ~57 s, green on every push (D38) |
| Bugs | 15 logged, 14 fixed, 0 open (`report.md`) |

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

## Next — v0.4 "You pick the paper" (recommended)

**Problem.** Generation is a one-shot gamble. arXiv returns up to eight results,
`pickPaper()` silently chooses one, and the user's only recovery from a bad
choice is to burn another of ten daily generations hoping for better. The paper
*is* the product; it should not be a lottery.

**Scope**
1. `/api/paper-search` (or a `searching` stage that pauses): return the top 3
   candidates with title, published date, category and abstract snippet.
2. Generate form becomes two steps: **find papers** → choose (or "shuffle") →
   **build roadmap**.
3. "Try another paper" on an existing project: same domain/language/skill, new
   paper, no manual re-entry.
4. Nothing is written to `projects` until a paper is chosen — so a shuffle costs
   no quota and no LLM call.

**Why this one first**
- Highest user-visible quality gain: control replaces luck.
- Saves free-tier quota instead of spending it (a shuffle is one arXiv call).
- Reuses the streaming work from D39; the `reading` event already carries the
  paper.
- Demoable in ten seconds: "here are three papers, pick one".

**Acceptance criteria**
- Choosing a paper and generating writes exactly one project row (no orphans).
- Shuffling five times costs zero generations (verify against the quota count).
- The chosen paper's title survives into the project, the share page and the
  `[llm]` log line.
- Offline test for the candidate-ranking/selection logic; CI stays green.

---

## v0.5 "Worth sharing" (small, high polish)

| Item | Why |
|---|---|
| **OG image for share links** (1200×630, `ImageResponse`) | a pasted link currently renders as plain text in Slack/X/Discord |
| **Export roadmap** — copy/download Markdown, print stylesheet | turns a read-only page into something a learner keeps |
| **Error boundaries** — `error.tsx`, `not-found.tsx`, offline copy | today an unexpected throw is a white screen |
| **Landing page proof** — one real roadmap preview, "how it works", honest cost line | the current landing page asserts value without showing it |

Exit test: paste a share link into a chat app and it looks deliberate; download a
roadmap and open it in an editor without cleanup.

---

## v0.6 "Hardened" (engineering, mostly invisible)

| Item | Why |
|---|---|
| **Server-action tests** with a fake Supabase client (rename, delete, share) | those paths need a session, so CI cannot reach them today |
| **Security headers / CSP** in `next.config.ts` | cheap, expected, no runtime cost |
| **Per-IP rate limit** in addition to per-user/day | ten accounts is currently ten times the quota |
| **Timing instrumentation** (`[generate] timings { arxivMs, llmMs, saveMs }`) | the log loop (D37) currently cannot answer "where did the 9 s go?" |
| **Accessibility pass** — keyboard focus, reduced motion, mobile header/dashboard | a portfolio project gets judged on this in ten seconds |

---

## v1.0 "Public" (only if the app earns it)

- **Public gallery** of link-shared roadmaps, opt-in only, filterable by domain.
  Requires a moderation answer first; sharing is currently unlisted by design.
- **Vercel Web Analytics** (free tier) + a small set of custom events
  (`generate_started`, `generate_done`, `share_created`).
- **README with screenshots/GIF** and a 60-second demo script.

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
| A1 | Paper preview + choose/shuffle | high | M | v0.4 |
| A2 | "Try another paper" from a project | high | S | v0.4 |
| B1 | OG image for share links | med | S | v0.5 |
| B2 | Export to Markdown / print | med | S | v0.5 |
| B3 | Error + not-found boundaries | med | S | v0.5 |
| B4 | Landing page proof section | med | M | v0.5 |
| C1 | Stage timing logs | med | S | v0.6 |
| C2 | Server-action tests | med | M | v0.6 |
| C3 | Security headers / CSP | low | S | v0.6 |
| C4 | Per-IP rate limit | low | M | v0.6 |
| C5 | Accessibility + responsive pass | med | M | v0.6 |
| D1 | Public gallery | low | L | v1.0 |
| D2 | Analytics + custom events | low | S | v1.0 |
| D3 | Screenshots / demo script | med | S | v1.0 |
| X1 | Streaming roadmap content | low (now) | L | deferred |

S = under an hour, M = an evening, L = a project.

---

## How we choose

1. Does it make the **core loop** (paper → roadmap) better? Those win.
2. Can it be verified without a paid service? If not, it waits.
3. Does it reduce free-tier spend or free-tier risk? Strong tiebreaker.
4. If two items tie, ship the smaller one — momentum compounds.
