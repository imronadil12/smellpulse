import {
  buildPublicDashboardPayload,
  getOrCreateClientSession,
  recordObservation,
} from './_db.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = getOrCreateClientSession(request);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Honeypot check for bots
    if (body.website || body.honeypot) {
      return Response.json({ error: 'Rejected' }, { status: 400 });
    }

    const kind = body.kind === 'no_odor' ? 'no_odor' : body.kind === 'odor' ? 'odor' : null;
    if (!kind) {
      return Response.json(
        { error: "kind must be 'odor' or 'no_odor'" },
        { status: 400 }
      );
    }

    let intensity: 1 | 2 | 3 | 4 | 5 | null = null;
    if (kind === 'odor') {
      const raw = Number(body.intensity);
      if (!Number.isInteger(raw) || raw < 1 || raw > 5) {
        return Response.json(
          { error: 'intensity must be an integer from 1 to 5 for odor reports' },
          { status: 400 }
        );
      }
      intensity = raw as 1 | 2 | 3 | 4 | 5;
    } else if (body.intensity !== undefined && body.intensity !== null) {
      return Response.json(
        { error: 'no_odor check-ins cannot include an intensity rating' },
        { status: 400 }
      );
    }

    const result = await recordObservation({
      tokenHash: session.tokenHash,
      shortHash: session.shortHash,
      kind,
      intensity,
    });

    if (result.cooldownError) {
      return Response.json(
        { error: result.cooldownError },
        {
          status: 429,
          headers: { 'Set-Cookie': session.setCookieHeader },
        }
      );
    }

    const dashboard = await buildPublicDashboardPayload();

    return Response.json(
      {
        observation: result.observation,
        dashboard,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Set-Cookie': session.setCookieHeader,
        },
      }
    );
  } catch (error) {
    console.error('[POST /api/observations] failed:', error);
    return Response.json(
      { error: 'Failed to submit observation' },
      { status: 500 }
    );
  }
}
