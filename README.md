# SmellPulse — Office Odor Observation Board

Mobile-first anonymous office odor observation board with a 45-minute live window, 1–5 auto-submit intensity picker with 10s thank-you cooldown, 7-day episode history, and protected admin moderation.

## Production Database Setup (Neon / Postgres on Vercel)

1. Provision Neon Postgres via Vercel Marketplace:
   ```bash
   vercel integration add neon
   vercel env pull .env.local --yes
   ```
2. Push schema and optional seed data:
   ```bash
   npm run db:push
   npm run db:seed
   ```
3. Or execute [`db/schema.sql`](db/schema.sql) directly against any PostgreSQL 15+ / Supabase / Neon database.
