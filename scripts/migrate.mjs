import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

// Load .env.local or .env if present
for (const envFile of ['.env.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const isSeed = process.argv.includes('--seed');

if (!dbUrl) {
  console.log(
    '[SmellPulse DB] DATABASE_URL is not set yet. Schema SQL is ready at db/schema.sql (API routes will use fallback store until DATABASE_URL is configured).'
  );
  process.exit(0);
}

const sql = neon(dbUrl);

async function run() {
  console.log('[SmellPulse DB] Applying schema from db/schema.sql...');

  await sql`
    CREATE TABLE IF NOT EXISTS anonymous_clients (
      id UUID PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS observations (
      id UUID PRIMARY KEY,
      client_id UUID NOT NULL REFERENCES anonymous_clients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('odor', 'no_odor')),
      intensity SMALLINT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_at TIMESTAMPTZ NULL,
      withdrawn_at TIMESTAMPTZ NULL,
      hidden_at TIMESTAMPTZ NULL,
      hidden_reason TEXT NULL,
      CONSTRAINT observations_kind_intensity_check CHECK (
        (kind = 'odor' AND intensity BETWEEN 1 AND 5) OR
        (kind = 'no_odor' AND intensity IS NULL)
      )
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_observations_submitted_at
      ON observations (submitted_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_observations_client_submitted
      ON observations (client_id, submitted_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id UUID PRIMARY KEY,
      observation_id UUID NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('hide', 'restore')),
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS office_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    INSERT INTO office_settings (key, value)
    VALUES ('safety_contact', 'Facilities Desk · Ext. 4400 / (555) 019-9400')
    ON CONFLICT (key) DO NOTHING
  `;

  console.log('[SmellPulse DB] Schema applied.');

  if (isSeed) {
    console.log('[SmellPulse DB] Seeding sample observations...');
    const sampleClients = ['seed-a', 'seed-b', 'seed-c', 'seed-d'];
    const intensities = [4, 3, 4, 3];
    for (let i = 0; i < sampleClients.length; i++) {
      const hash = crypto
        .createHash('sha256')
        .update(sampleClients[i])
        .digest('hex');
      const clientId = crypto.randomUUID();
      const rows = await sql`
        INSERT INTO anonymous_clients (id, token_hash)
        VALUES (${clientId}::uuid, ${hash})
        ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = NOW()
        RETURNING id
      `;
      const cid = rows[0].id;
      const obsId = crypto.randomUUID();
      await sql`
        INSERT INTO observations (id, client_id, kind, intensity, submitted_at)
        VALUES (${obsId}::uuid, ${cid}::uuid, 'odor', ${intensities[i]}, NOW() - (${(i + 1) * 4} || ' minutes')::interval)
      `;
    }
    console.log('[SmellPulse DB] Seed complete.');
  }
}

run().catch((err) => {
  console.error('[SmellPulse DB] Migration failed:', err);
  process.exit(1);
});
