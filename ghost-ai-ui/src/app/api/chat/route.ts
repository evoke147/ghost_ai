import { NextRequest } from 'next/server';
import { p2Redact } from '@/shared/utils/p2Proxy';

export const runtime = 'edge';

const KEYS = [
  process.env.OPENROUTER_API_KEY_1 || process.env.OPENROUTER_API_KEY || '',
  process.env.OPENROUTER_API_KEY_2 || '',
  process.env.OPENROUTER_API_KEY_3 || ''
];

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

/**
 * Streams response using Google Gemini as a fallback when OpenRouter keys are expired or rate-limited.
 */
async function streamWithGemini(messages: Array<{ role: string; content: string }>, modelName: string) {
  const contents = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GOOGLE_API_KEY}`;
  
  const geminiRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: {
        parts: [{ text: `You are an AI assistant streaming responses in GhostAI's privacy-focused comparison matrix representing ${modelName}. Be helpful, concise, and direct.` }]
      }
    })
  });

  if (!geminiRes.ok || !geminiRes.body) {
    const errText = await geminiRes.text().catch(() => '');
    console.error(`Gemini error: ${geminiRes.status}`, errText);
    throw new Error(`Gemini upstream error: ${geminiRes.status}`);
  }

  const reader = geminiRes.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  const sseChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
                  controller.enqueue(encoder.encode(sseChunk));
                }
              } catch {
                // Ignore partial JSON
              }
            }
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model, stream, columnIndex } = await req.json();

    // ── P2 Privacy Proxy: Automated Sensitive Data & PII Redaction ──
    let totalRedacted = 0;
    const detectedTypes = new Set<string>();
    const sanitizedMessages = Array.isArray(messages)
      ? messages.map((m: { role: string; content: string }) => {
          if (m.role === 'user' && typeof m.content === 'string') {
            const { sanitizedText, redactedCount, redactedTypes } = p2Redact(m.content);
            if (redactedCount > 0) {
              totalRedacted += redactedCount;
              redactedTypes.forEach(t => detectedTypes.add(t));
            }
            return { ...m, content: sanitizedText };
          }
          return m;
        })
      : messages;

    if (totalRedacted > 0) {
      console.log(`[P2 Proxy] Scrubbed ${totalRedacted} sensitive item(s) [${Array.from(detectedTypes).join(', ')}] from prompt.`);
    }

    const idx = (typeof columnIndex === 'number' && columnIndex >= 0 && columnIndex < KEYS.length) ? columnIndex : 0;
    const apiKey = KEYS[idx];

    console.log(`[Backend] Attempting model '${model}' using API Key Index: ${idx}`);

    let openRouterSucceeded = false;
    let response: globalThis.Response | null = null;

    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'GhostAI'
        },
        body: JSON.stringify({
          model,
          messages: sanitizedMessages,
          stream: stream ?? true
        })
      });

      if (response.ok && response.body) {
        openRouterSucceeded = true;
      }
    } catch {
      openRouterSucceeded = false;
    }

    // If OpenRouter succeeded, pipe its SSE stream directly
    if (openRouterSucceeded && response && response.body) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    // If OpenRouter returned 401/expired or failed, fall back to Gemini
    console.log(`[Backend] OpenRouter unavailable/expired (${response?.status ?? 'fetch error'}), falling back to Gemini`);
    return await streamWithGemini(sanitizedMessages, model);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Proxy Route Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
