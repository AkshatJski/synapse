# Synapse — Setup

Everything below is free. Total cost: **$0**.

Time: about 10 minutes.

---

## 1. Supabase (database + auth)

1. Create a project at <https://supabase.com/dashboard> (free tier: 500 MB, 2 projects).
2. **Project Settings → API** — copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **SQL Editor → New query** — paste the whole of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and run it.
   It creates `profiles`, `papers`, `projects`, `steps`, the signup trigger and
   every RLS policy.
4. **SQL Editor → New query** — paste
   [`supabase/migrations/0002_sharing.sql`](supabase/migrations/0002_sharing.sql) and run it.
   It adds `share_slug` / `shared_at` to `projects` and the read policies that make
   public share links work. Until it runs, the app still works and the project page
   shows a "run the migration" hint instead of a share button.
5. **Authentication → Providers**
   - **Email**: enabled by default. Magic links work with no extra setup.
   - **GitHub** (optional): create an OAuth app at
     <https://github.com/settings/developers> →
     callback URL `https://<your-project-ref>.supabase.co/auth/v1/callback`,
     then paste the client ID + secret into Supabase.
6. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/auth/callback`
   - Add your production URLs later (e.g. `https://synapse.vercel.app/auth/callback`).

## 2. AI provider (pick one)

### Groq (recommended — fast, generous free tier)

1. <https://console.groq.com/keys> → Create API key.
2. Put it in `.env.local` as `GROQ_API_KEY`.
3. Model used: `llama-3.3-70b-versatile` with JSON mode.

### Google Gemini (alternative / fallback)

1. <https://aistudio.google.com/apikey> → Create API key.
2. Put it in `.env.local` as `GEMINI_API_KEY`.
3. Model used: `gemini-2.5-flash` with `responseMimeType: application/json`.

Set `LLM_PROVIDER=groq` or `LLM_PROVIDER=gemini` to express a preference. If the
preferred provider has no key, the other one is used automatically.

## 3. Environment file

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
GROQ_API_KEY=gsk_...
LLM_PROVIDER=groq
```

`SUPABASE_SERVICE_ROLE_KEY` is **not** required by the current code. Do not add
it unless a future server job genuinely needs to bypass RLS.

## 4. Run

```bash
npm run dev
```

Open <http://localhost:3000> → **Generate a project** → sign in with GitHub or a
magic link → pick a domain, language and level.

## 5. Verify the install

| Check | Expected |
|---|---|
| `npm run build` | succeeds, 6 routes |
| `npm run lint` | clean |
| `npm run verify:arxiv` | 3 real papers printed |
| `/dashboard` without env | amber "Connect Supabase" card, no crash |
| `POST /api/generate` without env | `503 { "code": "NOT_CONFIGURED" }` |

## 6. Deploy to Vercel (free tier)

The repo is already deployed at <https://synapse-seven-ebon.vercel.app>, but the
steps are worth recording because two things bite:

1. **Directory name.** `vercel` derives the project name from the folder. A path
   like `C:\Folder D\Synapse` is not a legal project name (spaces + capitals), so
   link explicitly:
   ```bash
   vercel link --yes --project synapse
   vercel --prod --yes
   ```
2. **Git auto-deploy.** `vercel git connect` fails with *"Make sure there aren't
   any typos and that you have access to the repository"* when the Vercel GitHub
   App is not installed on the repo. Install it once:

   <https://github.com/apps/vercel/installations/new> → select
   `AkshatJski/synapse` → then re-run `vercel git connect`, or connect the repo
   from **Project → Settings → Git**.

### Environment variables on Vercel

Add the same three values you put in `.env.local`:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add GROQ_API_KEY production
```

Repeat with `preview` (and `development` if you use `vercel env pull`). Then
redeploy — env changes do not apply to an existing deployment:

```bash
vercel --prod
```

### Supabase redirect URLs for production

**Authentication → URL Configuration** must contain both origins, or OAuth and
magic links will land on `localhost` and fail:

- Site URL: `https://synapse-seven-ebon.vercel.app`
- Redirect URLs:
  - `http://localhost:3000/auth/callback`
  - `https://synapse-seven-ebon.vercel.app/auth/callback`

### Commit authorship (required for auto-deploy)

Vercel Hobby blocks deployments of commits it cannot attribute to the account
owner. Use the GitHub noreply address, which is always resolvable:

```bash
git config user.name "Akshat Mishra"
git config user.email "178628178+AkshatJski@users.noreply.github.com"
```

A commit authored with an unverified address (or a placeholder such as
`dev@synapse.local`) produces a `● Blocked` deployment with a 0 ms build, while
production keeps serving the previous build.

## 7. Troubleshooting


| Symptom | Cause | Fix |
|---|---|---|
| Redirected to `/login` in a loop | Redirect URL not allow-listed | Add `/auth/callback` to Supabase redirect URLs |
| `new row violates row-level security policy` | Migration not run, or ran against the wrong project | Re-run `0001_init.sql` |
| `No AI provider is configured` | No `GROQ_API_KEY` / `GEMINI_API_KEY` | Add one and restart the dev server |
| Magic link lands on `localhost:3000` in production | Site URL still local | Update Supabase URL configuration |
| Generation returns 404 `NO_PAPER` | Domain + language matched nothing | Use a broader domain |
| 429 `QUOTA_EXCEEDED` | 10 generations in 24h | Wait, or raise `DAILY_GENERATION_LIMIT` in `app/api/generate/route.ts` |
| Deploy state is **Blocked**, 0ms build, `errorLink` → `troubleshoot-project-collaboration#account-configuration` | Hobby plan + private repo: the **commit author must be the owner of the Vercel account**. Commits authored as e.g. `dev@synapse.local` cannot be attributed. | Author commits with the email on your Vercel account (`git config user.email …`), or connect GitHub under **Account Settings → Login Connections**. Then push and redeploy. |
| Env var is set but the app still shows the setup card | `SUPABASE_ANON_KEY` instead of `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without the `NEXT_PUBLIC_` prefix Next.js never inlines it into the client bundle, so `isSupabaseConfigured()` stays `false`. | Rename the variable, then **redeploy** — env changes never apply to an existing deployment. |
| `npm run dev` still says "Connect Supabase" after filling `.env.local` | Key typo (`SUPERBASE` vs `SUPABASE`) | Compare the names against `.env.example`; restart the dev server. |
