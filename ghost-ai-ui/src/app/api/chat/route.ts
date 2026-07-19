import { NextRequest } from 'next/server';

export const runtime = 'edge';

// We map keys manually based on column index (0, 1, 2)
// For local testing, we fallback to the explicit keys provided if env variables are missing.
const KEYS = [
  process.env.OPENROUTER_API_KEY_1 || '',
  process.env.OPENROUTER_API_KEY_2 || '',
  process.env.OPENROUTER_API_KEY_3 || ''
];

export async function POST(req: NextRequest) {
  try {
    const { messages, model, stream, columnIndex } = await req.json();

    // Default to the first key if columnIndex is out of bounds or missing
    const idx = (typeof columnIndex === 'number' && columnIndex >= 0 && columnIndex < KEYS.length) ? columnIndex : 0;
    const apiKey = KEYS[idx];

    console.log(`[Backend] Streaming model '${model}' using API Key Index: ${idx}`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'GhostAI'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: stream ?? true
      })
    });

    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: response.headers
      });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (err: any) {
    console.error('Proxy Route Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
