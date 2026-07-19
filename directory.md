# GhostAI: Project Architecture Map

## 1. Visual Tree Structure

```text
ghost-ai/
├── ghost-ai-ui/
│   ├── .env.local
│   ├── next.config.ts
│   ├── package.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   └── api/
│       │       └── chat/
│       │           ├── route.ts
│       │           └── purge/
│       │               └── route.ts
│       └── shared/
│           └── utils/
│               └── session.ts
├── hash-store/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   └── shared/
│   │       └── blockchain/
│   │           ├── midnightBridge.ts
│   │           └── bindings/
│   └── contract/
│       └── proof-of-existence.compact
└── midnight-local-dev/
    └── docker-compose.yml
```

## 2. Folder-by-Folder Breakdown

- `src/app/`: The Next.js App Router core layout. Contains the root `layout.tsx` for global application boundaries, `globals.css` for all native Tailwind utilities and custom CSS animations, and `page.tsx`, which serves as the primary multi-column UI matrix, containing the stream logic, the Landing Page wrapper, and the ZK blockchain operation toolbar.
- `src/app/api/chat/route.ts`: The multi-key OpenRouter stream routing matrix. This serverless edge function acts as an abstraction proxy, receiving client fetch requests, extracting the `columnIndex`, and securely rotating between three isolated OpenRouter API keys to prevent rate-limiting floods during parallel comparison streaming.
- `src/app/api/chat/purge/route.ts`: The background session nuke route. Designed to be called rapidly via a browser `Beacon` request, this endpoint forcefully invalidates backend contexts and interrupts upstream generative pipelines the instant a user engages the "Forget Me" privacy protocol.
- `src/shared/blockchain/`: Houses the `midnightBridge.ts` module, which handles wallet detection, dynamic payload assembly, and invocation of the smart contract logic. This directory also stores the compiled TypeScript bindings generated from the Compact ZK circuit.
- `src/shared/utils/session.ts`: The transient client-side context controller. It manages browser `sessionStorage`, ensuring that local history arrays are strictly ephemeral and cryptographically reset (via `crypto.randomUUID()`) when the user purges the session.

## 3. Design Choices Summary

The GhostAI architecture was explicitly engineered to balance zero-footprint anonymity with high-performance multi-model comparison:

- **Client-Side Multiplexing for Parallel Streaming:** The frontend (via `page.tsx`) explicitly handles multiplexing rather than forcing a heavy, monolithic backend to aggregate responses. The client dispatches independent concurrent fetch requests, assigning each a column index. This ensures UI threads remain non-blocking and one model timing out doesn't break the entire comparison matrix.
- **Server-Side Variable Security:** OpenRouter keys are strictly handled inside `.env.local` and processed by the `/api/chat` proxy matrix. At no point do client browsers execute directly against LLM providers, ensuring complete protection from key scraping and unauthorized usage.
- **Strict User Privacy Compliance:** The system is explicitly designed for zero persistence. By avoiding `localStorage` and traditional databases entirely in favor of `sessionStorage`, the GhostAI matrix guarantees that user sessions evaporate the moment the window closes or the "Nuke" protocol is initiated. The integration of Midnight blockchain ensures trustless proofs (anchoring conversation hashes to an immutable ledger) without ever writing plaintext context to a server log.
