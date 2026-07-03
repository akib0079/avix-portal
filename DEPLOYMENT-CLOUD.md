# Deploying on Hostinger Cloud hosting (+ free Supabase)

This is the path for **Cloud Startup / Cloud Professional / Business** plans —
no VPS needed. Hostinger runs the Next.js app; the database and uploaded files
live on **Supabase's free tier** (Hostinger cloud plans have no PostgreSQL and
no deploy-safe file storage; this split is the officially supported pattern).

> Using a KVM VPS instead? Follow [DEPLOYMENT.md](DEPLOYMENT.md) — the app
> auto-detects which mode it's in from the environment variables.

---

## 1. Supabase (free) — database + file storage (~10 min)

1. Sign up at [supabase.com](https://supabase.com) (free tier is plenty:
   500 MB database, 1 GB file storage).
2. **Create a project** — name `avix-portal`, pick the region closest to your
   Hostinger server (Europe if unsure), set a strong **database password**
   and save it.
3. When the project is ready, click **Connect** (top bar). You need TWO
   connection strings — swap `[YOUR-PASSWORD]` for the DB password:
   - **Transaction pooler** (port `6543`) → this becomes `DATABASE_URL`.
     Append `?pgbouncer=true&connection_limit=1` to the end.
   - **Direct connection** (port `5432`) → this becomes `DIRECT_URL`.
4. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and
   the **service_role** key (`SUPABASE_SERVICE_ROLE_KEY` — keep it secret).

That's all — the app creates its private storage bucket automatically on
first upload.

## 2. Hostinger — create the web app (~10 min)

1. hPanel → **Websites → Add website → Web app** (the Node.js flow).
2. **Domain**: choose `avixdigital.com` and enter subdomain `portal` →
   the app will live at `portal.avixdigital.com` (DNS is wired automatically
   since the domain is on the same account).
3. **Source** — either works:
   - **GitHub** (preferred — pushes auto-deploy): connect the
     `akib0079/avix-portal` repository, branch `main`.
   - **Upload files**: upload `avix-portal.zip` (see below for generating it).
4. **Framework / build settings**:
   - Framework: **Next.js**
   - Node version: **22**
   - Build command: `npm run build:cloud`
     (runs the database migrations, then builds — so every deploy migrates
     automatically)
   - Start command: `npm run start`
5. **Environment variables** — add ALL of these before the first deploy:

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase *Transaction pooler* string + `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase *Direct connection* string |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (any long random string) |
| `BETTER_AUTH_URL` | `https://portal.avixdigital.com` |
| `NEXT_PUBLIC_APP_URL` | `https://portal.avixdigital.com` |
| `RESEND_API_KEY` | your `re_...` key |
| `EMAIL_FROM` | `Avix Digital <portal@avixdigital.com>` |
| `ADMIN_NOTIFICATION_EMAIL` | `akibzawayed0079@gmail.com` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `SUPABASE_STORAGE_BUCKET` | `uploads` |
| `SEED_ADMIN_EMAIL` | `akibzawayed0079@gmail.com` |
| `SEED_ADMIN_PASSWORD` | a strong password — this becomes your admin login |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional — for Google sign-in |

6. **Deploy.** The build log should show Prisma migrations applying, then the
   Next.js build. On first boot the super admin account is created
   automatically.

If migrations don't run during build on your plan (build environment without
env vars), change the Start command to
`npx prisma migrate deploy && npm run start` instead.

## 3. Generating the upload ZIP (only if not using GitHub)

From the project folder on the Mac:

```bash
git archive --format=zip -o ~/Desktop/avix-portal.zip HEAD
```

This contains exactly the committed code — no `node_modules`, no `.env`, no
local uploads. Hostinger installs dependencies and builds from it.

## 4. After it's live — checklist

- [ ] `https://portal.avixdigital.com` loads with HTTPS
- [ ] Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
- [ ] Add a test client with an email you control → invite email arrives
- [ ] Upload an invoice PDF → download works → **redeploy the app** →
      download still works (files live in Supabase, surviving deploys)
- [ ] Client can't open `/admin` (404)
- [ ] Supabase dashboard → Database → Backups: free tier keeps daily backups

## 5. Keep-alive + uptime alerts (kills the free-tier pause, ~5 min)

Supabase's free tier pauses projects after ~1 week of zero activity. The app
ships a heartbeat endpoint at `/api/health` that touches the database — ping
it on a schedule and the project simply never idles:

1. Sign up free at [uptimerobot.com](https://uptimerobot.com) →
   **Add New Monitor** → type **HTTP(s)**.
2. URL: `https://portal.avixdigital.com/api/health` — interval **5 minutes**.
3. Add your email as the alert contact.

You get two things at once: the database never pauses, and you're emailed
within minutes if the portal ever goes down. (Alternative without a third
party: hPanel → Advanced → **Cron Jobs** →
`curl -fsS https://portal.avixdigital.com/api/health > /dev/null`, every 5
minutes.)

## Trade-offs vs the VPS path — and their fixes

- ~~Free-tier Supabase pauses when idle~~ → eliminated by the keep-alive above
- Two dashboards (Hostinger + Supabase) → day-to-day you only use the portal;
  Supabase needs zero maintenance and keeps its own daily database backups
- Shared CPU limits → a client portal's traffic is tiny; if you ever outgrow
  it, the same repo deploys to a VPS via DEPLOYMENT.md with no code changes
- Upside: $0 extra cost, no server maintenance, auto-deploys from GitHub
