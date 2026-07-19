/**
 * streamDiagnostics.ts
 *
 * Interactive Diagnostic Integration Suite for stream resilience.
 * Simulates network anomalies like sudden stream terminations and latency chokes
 * to verify the robustness of the frontend chat client.
 */

/**
 * getSimulatedDropStream
 *
 * Simulates a stream that terminates abruptly mid-way through transmission
 * without sending the final SSE stop token. Verifies that the UI recovers gracefully
 * and preserves the text received up to the disconnect.
 */
export function getSimulatedDropStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = [
    "Establishing ZK-channel connection... Done. ",
    "Retrieving anonymized model response... Done. ",
    "Analyzing context... [ANOMALY DETECTED: CONNECTION LOST DURING RESPONSE]"
  ];

  return new ReadableStream({
    async start(controller) {
      try {
        for (const paragraph of chunks) {
          const words = paragraph.split(' ');
          for (const word of words) {
            const mockChunk = {
              choices: [
                {
                  delta: {
                    content: word + ' '
                  }
                }
              ]
            };
            const sseString = `data: ${JSON.stringify(mockChunk)}\n\n`;
            controller.enqueue(encoder.encode(sseString));
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }
        // Forceful termination (close immediately without sending termination [DONE] event)
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

/**
 * simulateLatencySpike
 *
 * Artificially chokes request resolution to simulate a network delay.
 * Verifies that CSS loaders persist and user prompts are locked to prevent double-submits.
 */
export async function simulateLatencySpike(delayMs = 5000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
