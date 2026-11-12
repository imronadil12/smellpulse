import {
  buildPublicDashboardPayload,
  getAllObservations,
  getOrCreateClientSession,
  LIVE_WINDOW_MS,
  withdrawObservationByIdOrClient,
} from './_db.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const session = getOrCreateClientSession(request);
    const { observations } = await getAllObservations();
    const nowMs = Date.now();

    const current = observations.find(
      (o) =>
        o.clientTokenHash.startsWith(session.shortHash) &&
        !o.supersededAt &&
        !o.withdrawnAt &&
        !o.hiddenAt &&
        nowMs - o.submittedAt <= LIVE_WINDOW_MS
    );

    return Response.json(
      { observation: current ?? null },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Set-Cookie': session.setCookieHeader,
        },
      }
    );
  } catch (error) {
    console.error('[GET /api/my-observation] failed:', error);
    return Response.json(
      { error: 'Failed to read current observation' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const session = getOrCreateClientSession(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || undefined;

    await withdrawObservationByIdOrClient({
      observationId: id,
      tokenHash: session.tokenHash,
    });

    const dashboard = await buildPublicDashboardPayload();

    return Response.json(
      { withdrawn: true, dashboard },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Set-Cookie': session.setCookieHeader,
        },
      }
    );
  } catch (error) {
    console.error('[DELETE /api/my-observation] failed:', error);
    return Response.json(
      { error: 'Failed to withdraw observation' },
      { status: 500 }
    );
  }
}
