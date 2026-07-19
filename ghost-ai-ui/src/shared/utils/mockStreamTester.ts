/**
 * mockStreamTester.ts
 *
 * Offline client-side mock streaming engine.
 * Emits technical dummy text in SSE (Server-Sent Events) chunks every 50ms.
 * Mimics the upstream OpenRouter chunking format so the frontend can use it interchangeably.
 */

const MOCK_ANSWERS = [
  "Securing your terminal. [ZKP ENGINE] Generating local private state keys... Done. ",
  "Your conversation history is hashed locally using SHA-256. ",
  "The generated digest is pushed to the Midnight blockchain. ",
  "No data leaves this sandbox unencrypted. GhostAI acts as an zero-knowledge buffer between you and the LLM."
];

/**
 * Returns a ReadableStream that enqueues chunks of mock data at specified intervals.
 * Yields standard OpenRouter SSE format.
 */
export function getMockChatStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      try {
        for (const paragraph of MOCK_ANSWERS) {
          const words = paragraph.split(' ');
          for (const word of words) {
            // Mimic standard OpenRouter SSE JSON delta chunk
            const mockChunk = {
              choices: [
                {
                  delta: {
                    content: word + ' '
                  }
                }
              ]
            };
            
            const sseFormattedString = `data: ${JSON.stringify(mockChunk)}\n\n`;
            controller.enqueue(encoder.encode(sseFormattedString));
            
            // Artificial delay to simulate network streaming
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          
          // Paragraph separator pause
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (err) {
        console.error('Error during mock stream generation:', err);
      } finally {
        controller.close();
      }
    }
  });
}

/**
 * Helper to process the stream chunks just like standard browser fetch responses.
 */
export async function readMockStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  
  try {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Save last incomplete line in buffer
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              onChunk(delta);
            }
          } catch (e) {
            // Ignore parse errors from malformed test lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
