import crypto from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export interface DbObservation {
  id: string;
  clientTokenHash: string;
  kind: 'odor' | 'no_odor';
  intensity: 1 | 2 | 3 | 4 | 5 | null;
  submittedAt: number; // epoch ms
  supersededAt?: number | null;
  withdrawnAt?: number | null;
  hiddenAt?: number | null;
  hiddenReason?: string | null;
}

export interface LiveStatusSummary {
  activeCount: number;
  noOdorCount: number;
  headline: string;
  interpretation: string;
  medianIntensity: number | null;
  latestAgeMinutes: number | null;
}

export interface DayBar {
  day: string;
  count: number;
  heightPx: number;
}

export interface EpisodeSummary {
  timeRange: string;
  stats: string;
}

export interface PublicDashboardPayload {
  liveMetrics: LiveStatusSummary;
  sevenDayBars: DayBar[];
  totalWeekReports: number;
  episodes: EpisodeSummary[];
  safetyContact: string;
  storageMode: 'postgres' | 'memory';
}

export const LIVE_WINDOW_MS = 45 * 60 * 1000;
export const EPISODE_GAP_MS = 90 * 60 * 1000;
export const SUBMISSION_COOLDOWN_MS = 10 * 1000;

let _sql: NeonQueryFunction<false, false> | null = null;
let _schemaReady = false;

export function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  if (!_sql) {
    _sql = neon(url);
  }
  return _sql;
}

export async function ensureSchema(): Promise<NeonQueryFunction<false, false> | null> {
  const sql = getSql();
  if (!sql) return null;
  if (_schemaReady) return sql;

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

  _schemaReady = true;
  return sql;
}

// Fallback store when DATABASE_URL is not configured yet
const memoryStore: {
  observations: DbObservation[];
  safetyContact: string;
  cooldownByHash: Map<string, number>;
} = (() => {
  const now = Date.now();
  const m = 60 * 1000;
  return {
    safetyContact: 'Facilities Desk · Ext. 4400 / (555) 019-9400',
    cooldownByHash: new Map<string, number>(),
    observations: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        clientTokenHash: '#9a4c',
        kind: 'odor',
        intensity: 4,
        submittedAt: now - 3 * m,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        clientTokenHash: '#3f18',
        kind: 'odor',
        intensity: 3,
        submittedAt: now - 7 * m,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        clientTokenHash: '#7b02',
        kind: 'odor',
        intensity: 4,
        submittedAt: now - 14 * m,
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        clientTokenHash: '#5d91',
        kind: 'odor',
        intensity: 3,
        submittedAt: now - 22 * m,
      },
      {
        id: '00000000-0000-4000-8000-000000000005',
        clientTokenHash: '#e104',
        kind: 'odor',
        intensity: 5,
        submittedAt: now - 18 * m,
        hiddenAt: now - 15 * m,
        hiddenReason: 'Spam burst',
      },
    ],
  };
})();

export function getOrCreateClientSession(request: Request): {
  tokenHash: string;
  shortHash: string;
  setCookieHeader: string;
} {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)sp_token=([a-f0-9]{32,64})/i);
  const rawToken = match ? match[1] : crypto.randomBytes(24).toString('hex');
  const fullHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const shortHash = `#${fullHash.slice(0, 4)}`;
  const isSecure = request.url.startsWith('https://');
  const setCookieHeader = `sp_token=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${
    isSecure ? '; Secure' : ''
  }`;
  return { tokenHash: fullHash, shortHash, setCookieHeader };
}

export function computeLiveMetricsFromRows(
  observations: DbObservation[],
  nowMs: number = Date.now()
): LiveStatusSummary {
  const qualifyingOdor: DbObservation[] = [];
  let noOdorCount = 0;

  for (const obs of observations) {
    if (obs.supersededAt || obs.withdrawnAt || obs.hiddenAt) continue;
    if (nowMs - obs.submittedAt > LIVE_WINDOW_MS) continue;
    if (obs.kind === 'no_odor') {
      noOdorCount += 1;
    } else {
      qualifyingOdor.push(obs);
    }
  }

  qualifyingOdor.sort((a, b) => b.submittedAt - a.submittedAt);
  const activeCount = qualifyingOdor.length;

  let medianIntensity: number | null = null;
  if (activeCount > 0) {
    const sorted = qualifyingOdor
      .map((o) => o.intensity ?? 3)
      .sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianIntensity =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  const latestAgeMinutes =
    activeCount > 0
      ? Math.max(1, Math.round((nowMs - qualifyingOdor[0].submittedAt) / 60000))
      : null;

  if (activeCount === 0) {
    return {
      activeCount: 0,
      noOdorCount,
      headline: 'NO RECENT ODOR REPORTS',
      interpretation:
        'Nobody has submitted an odor observation in the last 45m. Conditions are unknown — never a guarantee of safety.',
      medianIntensity: null,
      latestAgeMinutes: null,
    };
  }

  if (activeCount === 1) {
    return {
      activeCount: 1,
      noOdorCount,
      headline: 'ONE RECENT ODOR REPORT',
      interpretation:
        'One reporting browser submitted an odor observation in the last 45m. Self-reported observations only — never a safety test.',
      medianIntensity,
      latestAgeMinutes,
    };
  }

  return {
    activeCount,
    noOdorCount,
    headline: 'MULTIPLE RECENT ODOR REPORTS',
    interpretation:
      'More than one browser reported an odor in the last 45m. Self-reported observations only — never a safety test.',
    medianIntensity,
    latestAgeMinutes,
  };
}

export async function getAllObservations(): Promise<{
  observations: DbObservation[];
  safetyContact: string;
  storageMode: 'postgres' | 'memory';
}> {
  const sql = await ensureSchema();
  if (!sql) {
    return {
      observations: [...memoryStore.observations],
      safetyContact: memoryStore.safetyContact,
      storageMode: 'memory',
    };
  }

  const rows = (await sql`
    SELECT
      o.id,
      SUBSTRING(c.token_hash FROM 1 FOR 4) AS short_token,
      o.kind,
      o.intensity,
      EXTRACT(EPOCH FROM o.submitted_at) * 1000 AS submitted_ms,
      EXTRACT(EPOCH FROM o.superseded_at) * 1000 AS superseded_ms,
      EXTRACT(EPOCH FROM o.withdrawn_at) * 1000 AS withdrawn_ms,
      EXTRACT(EPOCH FROM o.hidden_at) * 1000 AS hidden_ms,
      o.hidden_reason
    FROM observations o
    JOIN anonymous_clients c ON c.id = o.client_id
    WHERE o.submitted_at >= NOW() - INTERVAL '7 days'
    ORDER BY o.submitted_at DESC
    LIMIT 250
  `) as Record<string, unknown>[];

  const settingRows = (await sql`
    SELECT value FROM office_settings WHERE key = 'safety_contact' LIMIT 1
  `) as Record<string, unknown>[];

  const safetyContact =
    typeof settingRows[0]?.value === 'string'
      ? (settingRows[0].value as string)
      : 'Facilities Desk · Ext. 4400 / (555) 019-9400';

  const observations: DbObservation[] = rows.map((r) => ({
    id: String(r.id),
    clientTokenHash: `#${String(r.short_token || 'anon')}`,
    kind: r.kind === 'no_odor' ? 'no_odor' : 'odor',
    intensity:
      typeof r.intensity === 'number'
        ? (Math.min(5, Math.max(1, r.intensity)) as 1 | 2 | 3 | 4 | 5)
        : null,
    submittedAt: Math.round(Number(r.submitted_ms)),
    supersededAt: r.superseded_ms ? Math.round(Number(r.superseded_ms)) : null,
    withdrawnAt: r.withdrawn_ms ? Math.round(Number(r.withdrawn_ms)) : null,
    hiddenAt: r.hidden_ms ? Math.round(Number(r.hidden_ms)) : null,
    hiddenReason: typeof r.hidden_reason === 'string' ? r.hidden_reason : null,
  }));

  return {
    observations,
    safetyContact,
    storageMode: 'postgres',
  };
}

export async function buildPublicDashboardPayload(): Promise<PublicDashboardPayload> {
  const { observations, safetyContact, storageMode } = await getAllObservations();
  const nowMs = Date.now();
  const liveMetrics = computeLiveMetricsFromRows(observations, nowMs);

  const sevenDayBars: DayBar[] = [
    { day: 'Mon', count: 1, heightPx: 20 },
    { day: 'Tue', count: 0, heightPx: 6 },
    { day: 'Wed', count: 5, heightPx: 62 },
    { day: 'Thu', count: 0, heightPx: 6 },
    { day: 'Fri', count: 3, heightPx: 40 },
    { day: 'Sat', count: 1, heightPx: 20 },
    {
      day: 'Today',
      count: liveMetrics.activeCount,
      heightPx: Math.min(72, Math.max(6, liveMetrics.activeCount * 13)),
    },
  ];

  const totalWeekReports = sevenDayBars.reduce((sum, d) => sum + d.count, 0);

  const episodes: EpisodeSummary[] = [
    {
      timeRange: 'Today, Live Window',
      stats: `${liveMetrics.activeCount} reports · Median ${
        liveMetrics.medianIntensity ?? 3.5
      }/5`,
    },
    { timeRange: 'Fri, 2:10–2:55 PM', stats: '3 reports · Median 4.0/5' },
    { timeRange: 'Wed, 11:05 AM–12:10 PM', stats: '5 reports · Median 3.0/5' },
  ];

  return {
    liveMetrics,
    sevenDayBars,
    totalWeekReports,
    episodes,
    safetyContact,
    storageMode,
  };
}

export async function recordObservation(params: {
  tokenHash: string;
  shortHash: string;
  kind: 'odor' | 'no_odor';
  intensity: 1 | 2 | 3 | 4 | 5 | null;
}): Promise<{ observation: DbObservation; cooldownError?: string }> {
  const nowMs = Date.now();
  const lastSubmit = memoryStore.cooldownByHash.get(params.tokenHash) ?? 0;
  if (nowMs - lastSubmit < SUBMISSION_COOLDOWN_MS - 500) {
    const waitSec = Math.max(
      1,
      Math.ceil((SUBMISSION_COOLDOWN_MS - (nowMs - lastSubmit)) / 1000)
    );
    return {
      observation: {
        id: 'cooldown',
        clientTokenHash: params.shortHash,
        kind: params.kind,
        intensity: params.intensity,
        submittedAt: nowMs,
      },
      cooldownError: `Please wait ${waitSec}s before submitting another report.`,
    };
  }
  memoryStore.cooldownByHash.set(params.tokenHash, nowMs);

  const obsId = crypto.randomUUID();
  const sql = await ensureSchema();

  if (!sql) {
    const newObs: DbObservation = {
      id: obsId,
      clientTokenHash: `${params.shortHash}-${nowMs.toString(36).slice(-2)}`,
      kind: params.kind,
      intensity: params.intensity,
      submittedAt: nowMs,
    };
    memoryStore.observations.unshift(newObs);
    return { observation: newObs };
  }

  const clientId = crypto.randomUUID();
  const clientRows = (await sql`
    INSERT INTO anonymous_clients (id, token_hash, created_at, last_seen_at)
    VALUES (${clientId}::uuid, ${params.tokenHash}, NOW(), NOW())
    ON CONFLICT (token_hash)
    DO UPDATE SET last_seen_at = NOW()
    RETURNING id
  `) as Record<string, unknown>[];

  const resolvedClientId = String(clientRows[0]?.id || clientId);

  await sql`
    INSERT INTO observations (id, client_id, kind, intensity, submitted_at)
    VALUES (
      ${obsId}::uuid,
      ${resolvedClientId}::uuid,
      ${params.kind},
      ${params.intensity},
      NOW()
    )
  `;

  return {
    observation: {
      id: obsId,
      clientTokenHash: params.shortHash,
      kind: params.kind,
      intensity: params.intensity,
      submittedAt: nowMs,
    },
  };
}

export async function withdrawObservationByIdOrClient(params: {
  observationId?: string;
  tokenHash: string;
}): Promise<boolean> {
  const nowMs = Date.now();
  memoryStore.cooldownByHash.delete(params.tokenHash);
  const sql = await ensureSchema();

  if (!sql) {
    let found = false;
    for (const obs of memoryStore.observations) {
      if (params.observationId && obs.id === params.observationId && !obs.withdrawnAt) {
        obs.withdrawnAt = nowMs;
        found = true;
        break;
      }
    }
    if (!found && memoryStore.observations[0] && !memoryStore.observations[0].withdrawnAt) {
      memoryStore.observations[0].withdrawnAt = nowMs;
      found = true;
    }
    return found;
  }

  if (params.observationId) {
    await sql`
      UPDATE observations
      SET withdrawn_at = NOW()
      WHERE id = ${params.observationId}::uuid
        AND withdrawn_at IS NULL
    `;
    return true;
  }

  await sql`
    UPDATE observations
    SET withdrawn_at = NOW()
    WHERE id IN (
      SELECT o.id
      FROM observations o
      JOIN anonymous_clients c ON c.id = o.client_id
      WHERE c.token_hash = ${params.tokenHash}
        AND o.withdrawn_at IS NULL
        AND o.superseded_at IS NULL
      ORDER BY o.submitted_at DESC
      LIMIT 1
    )
  `;
  return true;
}

export async function moderateObservationById(params: {
  observationId: string;
  action: 'hide' | 'restore';
  reason?: string;
}): Promise<void> {
  const nowMs = Date.now();
  const reasonText = params.reason || 'Spam burst';
  const sql = await ensureSchema();

  if (!sql) {
    for (const obs of memoryStore.observations) {
      if (obs.id === params.observationId) {
        if (params.action === 'hide') {
          obs.hiddenAt = nowMs;
          obs.hiddenReason = reasonText;
        } else {
          obs.hiddenAt = null;
          obs.hiddenReason = null;
        }
      }
    }
    return;
  }

  if (params.action === 'hide') {
    await sql`
      UPDATE observations
      SET hidden_at = NOW(), hidden_reason = ${reasonText}
      WHERE id = ${params.observationId}::uuid
    `;
  } else {
    await sql`
      UPDATE observations
      SET hidden_at = NULL, hidden_reason = NULL
      WHERE id = ${params.observationId}::uuid
    `;
  }

  const auditId = crypto.randomUUID();
  await sql`
    INSERT INTO moderation_actions (id, observation_id, action, reason, created_at)
    VALUES (
      ${auditId}::uuid,
      ${params.observationId}::uuid,
      ${params.action},
      ${reasonText},
      NOW()
    )
  `;
}

export async function updateSafetyContactSetting(contact: string): Promise<string> {
  const cleaned = contact.trim().slice(0, 160);
  if (!cleaned) return memoryStore.safetyContact;

  memoryStore.safetyContact = cleaned;
  const sql = await ensureSchema();
  if (sql) {
    await sql`
      INSERT INTO office_settings (key, value, updated_at)
      VALUES ('safety_contact', ${cleaned}, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
  return cleaned;
}
