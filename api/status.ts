import {
  buildPublicDashboardPayload,
  getOrCreateClientSession,
} from './_db.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const session = getOrCreateClientSession(request);
    const payload = await buildPublicDashboardPayload();

    return Response.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Set-Cookie': session.setCookieHeader,
      },
    });
  } catch (error) {
    console.error('[GET /api/status] failed:', error);
    return Response.json(
      { error: 'Failed to load office live status' },
      { status: 500 }
    );
  }
}
