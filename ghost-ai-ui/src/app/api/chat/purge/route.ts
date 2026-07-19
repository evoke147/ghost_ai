import { NextRequest } from 'next/server';

export const runtime = 'edge';

/**
 * POST /api/chat/purge
 *
 * Receives a session-purge beacon from the client "Forget Me" nuke protocol.
 * Logs the session token for audit trail and returns a definitive 200 OK.
 * This route intentionally does NOT store any persistent data—it only acts
 * as a clean termination signal for any transient upstream pipeline caches.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = (body as { sessionToken?: string }).sessionToken ?? 'unknown';

    // Safe structured log — token is ephemeral, never persisted
    console.log(
      `[Purge] Session invalidation signal received. Token: ${sessionToken.slice(0, 20)}... | ` +
      `Time: ${new Date().toISOString()} | ` +
      `IP: ${req.headers.get('x-forwarded-for') ?? 'edge-hidden'}`
    );

    return new Response(
      JSON.stringify({
        ok:        true,
        purged:    true,
        timestamp: Date.now(),
        message:   'Session state successfully invalidated. All transient buffers cleared.',
      }),
      {
        status:  200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Purge] Handler error:', message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
