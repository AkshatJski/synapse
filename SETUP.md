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
4. **Authentication → Providers**
   - **Email**: enabled by default. Magic links work with no extra setup.
   - **GitHub** (optional): create an OAuth app at
     <https://github.com/settings/developers> →
     callback URL `https://<your-project-ref>.supabase.co/auth/v1/callback`,
     then paste the client ID + secret into Supabase.
5. **Authentication → URL Configuration**
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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Redirected to `/login` in a loop | Redirect URL not allow-listed | Add `/auth/callback` to Supabase redirect URLs |
| `new row violates row-level security policy` | Migration not run, or ran against the wrong project | Re-run `0001_init.sql` |
| `No AI provider is configured` | No `GROQ_API_KEY` / `GEMINI_API_KEY` | Add one and restart the dev server |
| Magic link lands on `localhost:3000` in production | Site URL still local | Update Supabase URL configuration |
| Generation returns 404 `NO_PAPER` | Domain + language matched nothing | Use a broader domain |
| 429 `QUOTA_EXCEEDED` | 10 generations in 24h | Wait, or raise `DAILY_GENERATION_LIMIT` in `app/api/generate/route.ts` |
