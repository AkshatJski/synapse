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
| Paper choice | **you pick from three candidates** — free shuffle, id-only handoff, no quota spent until you build (D41) |
| Progress | **streamed** stages from the server: searching → reading (real paper title) → planning → saving (D39) |
| Workspace | roadmaps, ELI5 summary, prerequisites, roadmap/paper tabs, optimistic step tracking |
| Sharing | opt-in `/p/<slug>`, read-only, revocable, anon RLS policy, generated OG card (D30–D33, D42) |
| Export | Markdown download (progress for the owner, none for visitors) + print styles (D42) |
| Management | rename + delete, two-step confirm, papers survive delete (D40) |
| Safety | PPR-safe rendering everywhere (`connection()`), daily quota 10/user, RLS as the boundary |
| CI | lint + **env-less** build + 8 offline specs, ~57 s, green on every push (D38) |
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

Exit test: CI runs eight offline specs; headers visible on a real `next start`
response; the quota and limit paths return the documented status codes.

---

## Next — v1.0 "Public" (only if the app earns it)

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
