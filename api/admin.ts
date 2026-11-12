import {
  buildPublicDashboardPayload,
  getAllObservations,
  moderateObservationById,
  updateSafetyContactSetting,
} from './_db.ts';

function isAuthorizedAdmin(request: Request): boolean {
  const configuredPin = process.env.ADMIN_PIN;
  if (!configuredPin) return true;
  const headerPin = request.headers.get('x-admin-pin') || '';
  return headerPin === configuredPin;
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedAdmin(request)) {
      return Response.json({ error: 'Unauthorized admin pin' }, { status: 401 });
    }

    const { observations, safetyContact, storageMode } = await getAllObservations();
    const activeObs = observations.filter((o) => !o.supersededAt && !o.withdrawnAt);

    return Response.json(
      {
        observations: activeObs,
        safetyContact,
        storageMode,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (error) {
    console.error('[GET /api/admin] failed:', error);
    return Response.json(
      { error: 'Failed to load admin moderation data' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedAdmin(request)) {
      return Response.json({ error: 'Unauthorized admin pin' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (body.type === 'moderate') {
      const observationId = String(body.observationId || '');
      const action = body.action === 'restore' ? 'restore' : 'hide';
      const reason = typeof body.reason === 'string' ? body.reason : 'Spam burst';
      if (!observationId) {
        return Response.json(
          { error: 'observationId is required' },
          { status: 400 }
        );
      }
      await moderateObservationById({ observationId, action, reason });
    } else if (body.type === 'settings') {
      const safetyContact = String(body.safetyContact || '');
      await updateSafetyContactSetting(safetyContact);
    } else {
      return Response.json({ error: 'Unknown admin action' }, { status: 400 });
    }

    const [{ observations, safetyContact, storageMode }, dashboard] =
      await Promise.all([getAllObservations(), buildPublicDashboardPayload()]);

    return Response.json(
      {
        observations: observations.filter((o) => !o.supersededAt && !o.withdrawnAt),
        safetyContact,
        storageMode,
        dashboard,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/admin] failed:', error);
    return Response.json(
      { error: 'Failed to execute admin moderation action' },
      { status: 500 }
    );
  }
}
