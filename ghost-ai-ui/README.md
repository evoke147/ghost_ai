# ◈ GhostAI — Privacy-Focused UI & P2 Proxy Enclave

The Next.js 16 frontend workspace for **GhostAI**, featuring the **Privacy Enclave**, **P2 Sensitive Data Redaction Proxy**, **Multi-Model Parallel Inference**, and **Midnight Zero-Knowledge Proofs**.

---

## 🚀 Key Features

- **P2 Privacy Proxy**: Automatic real-time regex & pattern redaction of PII, API tokens, phone numbers, payment cards, national IDs, and private keys before prompts reach LLMs.
- **RAM-Only Ephemeral Enclave**: Operates exclusively in browser volatile memory (`sessionStorage`). Zero persistent cookies, zero local storage, zero database logging.
- **Parallel Multi-Model Comparison**: Stream up to 3 frontier LLMs concurrently (GPT OSS 20B, Gemma 4, Nemotron Super 120B, Laguna, Cohere) with isolated column decoders.
- **Midnight ZK Proof of Existence**: Seal conversation state into a SHA-256 cryptographic digest committed to the Midnight blockchain. Verify integrity against the immutable ledger.
- **Cryptographic Shredder**: 2-phase immediate zeroization protocol with upstream purge beacon.

---

## 🛠️ Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start development server with hot reload
npm run dev

# 3. Production build
npm run build
npm start
```

Runs on [http://localhost:3000](http://localhost:3000).

---

## 📋 Environment Configuration

Create `.env.local`:

```env
# Google Gemini API key for high-speed edge streaming fallback
GOOGLE_API_KEY=your_gemini_api_key

# OpenRouter multi-key matrix (optional)
OPENROUTER_API_KEY_1=your_key_col_0
OPENROUTER_API_KEY_2=your_key_col_1
OPENROUTER_API_KEY_3=your_key_col_2

# Midnight Smart Contract
NEXT_PUBLIC_NETWORK_ID=undeployed
NEXT_PUBLIC_CONTRACT_ADDRESS=5681d5e55d4705159466441be78c1a5eaa80dd8a15d68a90166a0792ec3e9d97
```

---

## 📁 Directory Layout

```text
src/
├── app/
│   ├── api/
│   │   └── chat/
│   │       ├── route.ts        # P2 Proxy sanitization & multi-key stream router
│   │       └── purge/
│   │           └── route.ts    # Ephemeral session invalidation beacon
│   ├── favicon.ico
│   ├── globals.css             # Privacy theme tokens & glassmorphism styling
│   ├── layout.tsx              # Root HTML layout & metadata
│   └── page.tsx                # Privacy landing hero, workspace, & ZK toolbar
└── shared/
    └── utils/
        ├── p2Proxy.ts          # Automated sensitive data & PII redaction engine
        └── session.ts          # Ephemeral volatile RAM session controller
```
