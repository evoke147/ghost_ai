/// <reference types="node" />

/**
 * test-multi-key-concurrency.ts
 *
 * Automated Concurrency Test Driver Script
 * Simulates an immediate 3-model parallel submission using all three keys simultaneously.
 * Parses response chunks to the console to verify that all three keys are fully functional.
 * 
 * Usage: npx tsx test-multi-key-concurrency.ts
 */

const ENDPOINT = 'http://localhost:3000/api/chat';

const TEST_PAYLOADS = [
  {
    name: 'Model 1 (Key 1)',
    body: {
      messages: [{ role: 'user', content: 'Say "I am Key 1" in exactly 4 words.' }],
      model: 'openai/gpt-oss-20b:free',
      stream: true,
      columnIndex: 0
    }
  },
  {
    name: 'Model 2 (Key 2)',
    body: {
      messages: [{ role: 'user', content: 'Say "I am Key 2" in exactly 4 words.' }],
      model: 'openai/gpt-oss-20b:free', // use same free model to ensure standard baseline
      stream: true,
      columnIndex: 1
    }
  },
  {
    name: 'Model 3 (Key 3)',
    body: {
      messages: [{ role: 'user', content: 'Say "I am Key 3" in exactly 4 words.' }],
      model: 'openai/gpt-oss-20b:free',
      stream: true,
      columnIndex: 2
    }
  }
];

async function runParallelTests() {
  console.log(`\n🚀 Initiating Multi-Key Concurrency Test across 3 independent streams...`);
  console.log(`Targeting local proxy route: ${ENDPOINT}\n`);

  const streamPromises = TEST_PAYLOADS.map(async (payload) => {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload.body)
      });

      if (!response.ok) {
        console.error(`❌ [${payload.name}] Fetch failed with status: ${response.status}`);
        return;
      }

      console.log(`🟢 [${payload.name}] Connection established. Stream active.`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(`✅ [${payload.name}] Stream successfully completed.`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                // Print the incoming chunk inline to prove concurrent receiving
                process.stdout.write(`\x1b[36m[${payload.name}]:\x1b[0m ${delta}\n`);
              }
            } catch (e) {
              // Ignore partial JSON parse chunks
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ [${payload.name}] Exception encountered:`, err.message);
    }
  });

  await Promise.allSettled(streamPromises);
  console.log(`\n🏁 Concurrency test completed! If all streams succeeded, multi-key architecture is verified.`);
}

runParallelTests();
