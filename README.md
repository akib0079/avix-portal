# Avix Digital Client Portal

A full-stack client portal and admin system for [Avix Digital](https://avixdigital.com):
manage clients, projects, milestones, and invoices — and give every client a
private, real-time view of their project with the ability to request new work.

## Features

**Admin (you)**
- Dashboard with client/project/invoice counts, paid revenue, and an invoice-status donut
- Client management — clients are invite-only; adding one emails them a secure
  "set your password" link (no passwords ever sent in plain text)
- Projects with type, source, priority, status, dates, and rich-text scope notes
- Default milestones auto-created per project type (Shopify, WordPress, Webflow,
  Custom Web Dev, App Dev, UI Design Figma) — then drag to reorder, edit, delete
- Milestone pricing: hourly (rate × estimated hours), fixed, or no charge —
  shown as e.g. `$80.00/hr × 5h = $400.00`
- Invoices with automatic `INV-001` numbering, PDF upload, status tracking
  (Assigned → Sent → In Review → Paid), and one-click "Send to client" email
- Task Requests inbox with a live sidebar badge — approve a client request
  (set pricing, it becomes a milestone) or reject it with a note that's emailed

**Client portal**
- Read-only overview: project progress bars, open invoice total, recent updates
- Visual project timeline with milestone statuses and pricing
- Invoice list with authenticated PDF downloads
- "Request a task" with a rich-text editor and image uploads

**Security**
- better-auth (scrypt hashing, Postgres sessions, login rate limiting)
- Optional Google sign-in — invite-only preserved: Google signs in accounts
  the admin created, unknown Google accounts are rejected
- Every query is scoped in the data-access layer — clients can only ever see
  rows tied to their own account; cross-client access reads as 404
- Uploads validated by magic bytes (no SVG), stored outside the web root, and
  served only through auth-checked routes

## Stack

Next.js (App Router) · TypeScript · PostgreSQL · Prisma · better-auth ·
Tailwind CSS v4 + shadcn/ui · Tiptap · dnd-kit · Recharts · Resend + react-email

## Local development

```bash
# 1. PostgreSQL 17 (Homebrew)
brew install postgresql@17 && brew services start postgresql@17
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres \
  -c "CREATE ROLE portal WITH LOGIN PASSWORD 'portal' CREATEDB;" \
  -c "CREATE DATABASE portal OWNER portal;"
# (or use Docker instead: docker compose -f docker-compose.dev.yml up -d)

# 2. Configure
cp .env.example .env   # then fill in BETTER_AUTH_SECRET, SEED_ADMIN_PASSWORD, etc.

# 3. Install & migrate
npm install
npx prisma migrate dev

# 4. Run
npm run dev
```

The super admin account (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) is created
automatically on first boot. Without `RESEND_API_KEY`, emails are logged to the
server console instead of being sent — invite links included, so the whole flow
is testable offline.

Useful commands:

```bash
npx prisma studio        # browse the database visually
npx react-email dev      # preview the email templates
npm run build            # production build check
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete, step-by-step guide to
deploying on a Hostinger KVM VPS with Docker, Caddy (automatic HTTPS),
Resend domain verification, and nightly backups.
