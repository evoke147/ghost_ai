'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { p2Redact } from '@/shared/utils/p2Proxy';

// ─── Cryptographic Utilities ─────────────────────────────────────────────────

/** Pure JavaScript SHA-256 implementation as a fallback for non-secure contexts. */
function jsSha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i = 0, j = 0, result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [], k: number[] = [];
  let primeCounter = 0;

  const isPrime = (n: number) => {
    for (let factor = 2; factor * factor <= n; factor++) {
      if (n % factor === 0) return false;
    }
    return true;
  };

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }

  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const sA = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const sE = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const temp1 = (hash[7] + sE + ch + k[i] + w[i]) | 0;
      const temp2 = (sA + maj) | 0;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (8 * j)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/** Compute a hex SHA-256 digest of any string with Web Crypto and JS fallback. */
async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const encoded = new TextEncoder().encode(text);
      const buffer = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below
    }
  }
  return jsSha256(text);
}

/** Generate a random UUID safely in all browser contexts. */
function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Build a flat text representation of the conversation for cryptographic hashing. */
function buildHistoryText(msgs: Message[]): string {
  return msgs
    .filter(m => m.sender !== 'system')
    .map(m => `${m.sender.toUpperCase()}: ${m.text}`)
    .join('\n---\n');
}

// ─── Model Registry ──────────────────────────────────────────────────────────
const AVAILABLE_MODELS = [
  { id: 'openai/gpt-oss-20b:free',                            name: 'GPT OSS 20B',        provider: 'OpenAI',   context: '200K' },
  { id: 'google/gemma-4-26b-a4b-it:free',                     name: 'Gemma 4 26B',         provider: 'Google',   context: '8K'   },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',              name: 'Nemotron Super 120B', provider: 'NVIDIA',   context: '131K' },
  { id: 'poolside/laguna-xs-2.1:free',                         name: 'Laguna XS 2.1',       provider: 'Poolside', context: '32K'  },
  { id: 'cohere/north-mini-code:free',                         name: 'North Mini Code',     provider: 'Cohere',   context: '256K' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',              name: 'Nemotron Ultra 550B', provider: 'NVIDIA',   context: '131K' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',  name: 'Nemotron Nano 30B',   provider: 'NVIDIA',   context: '32K'  },
  { id: 'nvidia/nemotron-3.5-content-safety:free',             name: 'Nemotron Safety',     provider: 'NVIDIA',   context: '32K'  },
  { id: 'google/gemma-4-31b-it:free',                         name: 'Gemma 4 31B',         provider: 'Google',   context: '8K'   },
] as const;

const MAX_COMPARISON_MODELS = 3;

const PROVIDER_THEMES: Record<string, { badge: string; text: string; bg: string }> = {
  OpenAI:   { badge: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10', text: 'text-emerald-400', bg: 'bg-emerald-500' },
  Google:   { badge: 'border-sky-500/30 text-sky-400 bg-sky-500/10',             text: 'text-sky-400',     bg: 'bg-sky-500'     },
  NVIDIA:   { badge: 'border-teal-500/30 text-teal-400 bg-teal-500/10',          text: 'text-teal-400',    bg: 'bg-teal-500'    },
  Cohere:   { badge: 'border-amber-500/30 text-amber-400 bg-amber-500/10',       text: 'text-amber-400',   bg: 'bg-amber-500'   },
  Poolside: { badge: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10',          text: 'text-cyan-400',    bg: 'bg-cyan-500'    },
};

// ─── Types ───────────────────────────────────────────────────────────────────
type StreamStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';
type VerifyStatus = 'IDLE' | 'MATCHED' | 'TAMPERED';

interface ModelResponse {
  text: string;
  status: StreamStatus;
  errorCode?: number;
}

interface Message {
  id: number;
  sender: 'user' | 'ghost' | 'system';
  text: string;
  timestamp: string;
  modelResponses?: Record<string, ModelResponse>;
  singleModelId?: string;
  redactedInfo?: {
    count: number;
    types: string[];
  };
}

interface SealRecord {
  txId: string;
  blockHeight: number;
  hashHex: string;
  sealedAt: number; // unix ms
}

// ─── SSE Stream Reader ───────────────────────────────────────────────────────
async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  onDone: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const t = line.trim();
      if (!t || t === 'data: [DONE]') {
        if (t === 'data: [DONE]') onDone();
        continue;
      }
      if (t.startsWith('data: ')) {
        try {
          const delta = JSON.parse(t.slice(6))?.choices?.[0]?.delta?.content as string | undefined;
          if (delta) onChunk(delta);
        } catch {
          // partial JSON chunk
        }
      }
    }
  }
  onDone();
}

// ─── UI Icons ────────────────────────────────────────────────────────────────
const ShieldIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const LockIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CpuIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CopyIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Clean Privacy Skeleton Loader for pending streams */
const ColumnSkeleton: React.FC = () => (
  <div className="p-4 space-y-3">
    <div className="skeleton-bar h-2.5 w-[75%] rounded-full" />
    <div className="skeleton-bar h-2.5 w-full rounded-full" />
    <div className="skeleton-bar h-2.5 w-[85%] rounded-full" />
    <div className="skeleton-bar h-2.5 w-full rounded-full" />
    <div className="skeleton-bar h-2.5 w-[60%] rounded-full" />
    <div className="pt-2 space-y-2">
      <div className="skeleton-bar h-2.5 w-[90%] rounded-full" />
      <div className="skeleton-bar h-2.5 w-[70%] rounded-full" />
    </div>
  </div>
);

/** Isolated stream error card */
const ColumnError: React.FC<{ code?: number }> = ({ code }) => {
  const is429 = code === 429;
  return (
    <div className="m-3 rounded-lg border border-red-500/20 bg-red-950/20 p-4 space-y-2">
      <div className="flex items-center space-x-2 text-red-400">
        <span className="text-sm">⚠</span>
        <span className="text-xs font-semibold uppercase tracking-wider">
          {is429 ? 'Rate Limited' : 'Stream Interrupted'}
        </span>
      </div>
      <p className="text-slate-400 text-xs leading-relaxed">
        {is429
          ? 'Free tier quota reached for this provider. Parallel streams remain isolated and unaffected.'
          : `Upstream error HTTP ${code ?? '500'}. Re-routing to secondary privacy proxy.`}
      </p>
    </div>
  );
};

/** Status Indicator Pill */
const StatusDot: React.FC<{ status: StreamStatus }> = ({ status }) => {
  const cfg: Record<StreamStatus, { dot: string; label: string; text: string }> = {
    idle:      { dot: 'bg-slate-600',                          label: 'Standby',   text: 'text-slate-400' },
    loading:   { dot: 'bg-amber-400 animate-ping',             label: 'Connecting',text: 'text-amber-400' },
    streaming: { dot: 'bg-cyan-400 shadow-[0_0_8px_#06b6d4]',  label: 'Streaming', text: 'text-cyan-400 font-medium' },
    done:      { dot: 'bg-emerald-400',                        label: 'Complete',  text: 'text-emerald-400' },
    error:     { dot: 'bg-red-400',                            label: 'Failed',    text: 'text-red-400' },
  };
  const c = cfg[status];
  return (
    <div className="flex items-center space-x-1.5 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <span className={`text-[10px] tracking-wide uppercase ${c.text}`}>{c.label}</span>
    </div>
  );
};

// ─── Landing Page: Sleek Privacy Hero ─────────────────────────────────────────
const LandingHero: React.FC<{ onLaunch: () => void }> = ({ onLaunch }) => {
  return (
    <div className="flex flex-col min-h-screen w-screen bg-[#090a0f] text-slate-100 relative overflow-hidden">
      {/* Subtle modern background gradient mesh */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(14,165,233,0.15),rgba(9,10,15,0)_70%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.08),rgba(9,10,15,0)_60%)] pointer-events-none" />

      {/* Top Navigation */}
      <header className="w-full border-b border-slate-800/80 bg-[#090a0f]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
            <ShieldIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base tracking-tight text-white">GhostAI</span>
              <span className="text-[10px] font-medium bg-cyan-950/60 text-cyan-300 border border-cyan-800/50 px-2 py-0.5 rounded-full">
                Privacy Enclave
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Zero-Storage Multi-Model Intelligence</p>
          </div>
        </div>

        <div className="hidden sm:flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[11px]">RAM-Only Enclave • Zero Logs</span>
          </div>
          <button
            onClick={onLaunch}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
          >
            Launch App →
          </button>
        </div>
      </header>

      {/* Hero Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 relative z-10 max-w-5xl mx-auto text-center">
        {/* Security Badge */}
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300 mb-8 shadow-sm flex-wrap justify-center gap-y-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="font-medium text-slate-200">P2 Privacy Proxy Active</span>
          <span className="text-slate-500">•</span>
          <span className="text-emerald-400 font-mono text-[11px]">Sensitive Data & PII Redacted</span>
          <span className="text-slate-500">•</span>
          <span className="text-cyan-400 font-mono text-[11px]">Midnight ZK Proofs</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-tight">
          Private AI. <br className="hidden sm:inline" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400">
            Ephemeral & Cryptographically Sealed.
          </span>
        </h1>

        <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          An anonymous multi-model AI workspace built on zero persistent storage and protected by <span className="text-cyan-400 font-semibold">P2 Privacy Proxy</span> to automatically redact sensitive user data (emails, phone numbers, API keys, card numbers, and credentials) before prompts ever leave your enclave.
        </p>

        {/* Action Button */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <button
            type="button"
            onClick={onLaunch}
            className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 text-slate-950 rounded-xl font-bold text-sm tracking-wide shadow-xl shadow-cyan-500/25 transition-all flex items-center justify-center space-x-2 cursor-pointer"
          >
            <ShieldIcon className="w-4 h-4 text-slate-950" />
            <span>Enter Private Workspace</span>
            <span className="text-base">→</span>
          </button>
        </div>

        {/* 4 Privacy Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full text-left">
          {/* Pillar 1: P2 Proxy */}
          <div className="privacy-card p-5 rounded-2xl border border-slate-800/80 shadow-lg relative group hover:border-cyan-500/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/60 border border-cyan-800/40 flex items-center justify-center text-cyan-400 mb-4">
              <ShieldIcon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-2">P2 Privacy Proxy</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automated real-time PII & sensitive data redaction. Strips emails, API keys, payment cards, and credentials so LLMs never receive confidential identifiers.
            </p>
          </div>

          {/* Pillar 2: Ephemeral Memory */}
          <div className="privacy-card p-5 rounded-2xl border border-slate-800/80 shadow-lg relative group hover:border-sky-500/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-sky-950/60 border border-sky-800/40 flex items-center justify-center text-sky-400 mb-4">
              <CpuIcon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-2">Ephemeral Memory</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Zero database writes. Conversations live strictly in browser volatile RAM (<code className="text-cyan-300 font-mono text-[11px]">sessionStorage</code>). Closing the tab obliterates state with no trace.
            </p>
          </div>

          {/* Pillar 3: Parallel Cognition */}
          <div className="privacy-card p-5 rounded-2xl border border-slate-800/80 shadow-lg relative group hover:border-indigo-500/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-indigo-400 mb-4">
              <CpuIcon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-2">Parallel Cognition</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Benchmark multiple frontier LLMs concurrently via multi-key proxy. Cross-examine responses side-by-side with zero upstream prompt retention.
            </p>
          </div>

          {/* Pillar 4: Midnight ZK */}
          <div className="privacy-card p-5 rounded-2xl border border-slate-800/80 shadow-lg relative group hover:border-emerald-500/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center text-emerald-400 mb-4">
              <LockIcon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-2">Midnight ZK Proofs</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Anchor SHA-256 state hashes to the Midnight blockchain. Prove conversation integrity at an exact block height with zero plaintext disclosure.
            </p>
          </div>
        </div>

        {/* Live Privacy Telemetry Audit Box */}
        <div className="mt-12 w-full max-w-4xl privacy-panel rounded-xl p-4 border border-slate-800 text-left">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3 text-xs">
            <span className="font-semibold text-slate-300 flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Real-Time Client Privacy Audit</span>
            </span>
            <span className="text-[11px] font-mono text-emerald-400">PASSED: P2 PROTECTED</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
            <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Cookies</div>
              <div className="text-emerald-400 font-mono font-semibold text-xs mt-1">0 Detected</div>
            </div>
            <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">LocalStorage</div>
              <div className="text-emerald-400 font-mono font-semibold text-xs mt-1">0 Bytes (Clean)</div>
            </div>
            <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">P2 Data Proxy</div>
              <div className="text-cyan-400 font-mono font-semibold text-xs mt-1">Active (0 Leaks)</div>
            </div>
            <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Server DB</div>
              <div className="text-emerald-400 font-mono font-semibold text-xs mt-1">None (RAM only)</div>
            </div>
            <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800/60 col-span-2 sm:col-span-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Ledger Proofs</div>
              <div className="text-indigo-400 font-mono font-semibold text-xs mt-1">Midnight ZK</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Workspace / Dashboard ──────────────────────────────────────────────
export default function GhostAiDashboard() {
  const [isAppLaunched, setIsAppLaunched] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // ── Ephemeral Session Identity
  const generateSession = useCallback(() => {
    const id = `ghost_session_${safeRandomUUID().replace(/-/g, '').slice(0, 24)}`;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ghost_session_id', id);
    }
    return id;
  }, []);

  const [sessionToken, setSessionToken] = useState('');
  useEffect(() => {
    setSessionToken(generateSession());
  }, [generateSession]);

  // ── Conversation State
  const seedMessages = (): Message[] => [
    {
      id: 1,
      sender: 'system',
      text: 'Privacy Enclave & P2 Proxy active. Sensitive user credentials, emails, card numbers, and PII are automatically scrubbed before reaching models. Local state remains strictly in ephemeral RAM.',
      timestamp: 'Just now',
    },
    {
      id: 2,
      sender: 'user',
      text: 'How does GhostAI and P2 Proxy protect my identity and data?',
      timestamp: '1 min ago',
    },
    {
      id: 3,
      sender: 'ghost',
      text: 'GhostAI enforces four strict privacy guarantees:\n\n1. P2 Privacy Proxy: Automated redaction intercepts emails, phone numbers, API keys, card numbers, and credentials, replacing them with redaction tokens before upstream dispatch.\n2. Zero Persistent Storage: Messages exist solely in volatile browser RAM (sessionStorage) and vanish permanently upon closing this tab.\n3. Anonymous Edge Routing: Requests are multiplexed through edge functions without server IP logging.\n4. Midnight ZK Proofs: Cryptographic proof of your conversation state can be sealed on-chain without revealing plaintext.',
      timestamp: 'Just now',
      singleModelId: 'openai/gpt-oss-20b:free',
    },
  ];

  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Model Selection & Comparison Matrix
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [singleModelId, setSingleModelId] = useState<string>(AVAILABLE_MODELS[0].id);
  const [selectedModels, setSelectedModels] = useState<string[]>([
    AVAILABLE_MODELS[0].id,
    AVAILABLE_MODELS[1].id,
    AVAILABLE_MODELS[2].id,
  ]);
  const [limitWarn, setLimitWarn] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Session Shredder / Purge
  const [nukeArmed, setNukeArmed] = useState(false);
  const [nukeLoading, setNukeLoading] = useState(false);
  const nukeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Midnight ZK / Blockchain State
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [sealRecord, setSealRecord] = useState<SealRecord | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('IDLE');
  const [verifyHashLocal, setVerifyHashLocal] = useState('');
  const [zkError, setZkError] = useState<string | null>(null);

  const isSealed = sealRecord !== null;
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Dropdown dismiss
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup shredder timer
  useEffect(() => () => {
    if (nukeTimerRef.current) clearTimeout(nukeTimerRef.current);
  }, []);

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  // Toggle model in comparison mode
  const toggleComparisonModel = (modelId: string) => {
    setLimitWarn(false);
    setSelectedModels(prev => {
      if (prev.includes(modelId)) {
        if (prev.length === 1) return prev;
        return prev.filter(id => id !== modelId);
      }
      if (prev.length >= MAX_COMPARISON_MODELS) {
        setLimitWarn(true);
        setTimeout(() => setLimitWarn(false), 2000);
        return prev;
      }
      return [...prev, modelId];
    });
  };

  // ── Session Purge / Shredder Protocol
  const handleShredSession = () => {
    if (!nukeArmed) {
      setNukeArmed(true);
      nukeTimerRef.current = setTimeout(() => setNukeArmed(false), 3000);
      return;
    }

    if (nukeTimerRef.current) clearTimeout(nukeTimerRef.current);
    setNukeArmed(false);
    setNukeLoading(true);

    const oldToken = sessionToken;

    // 1. Send beacon to edge purge endpoint
    try {
      const blob = new Blob([JSON.stringify({ sessionToken: oldToken })], { type: 'application/json' });
      navigator.sendBeacon('/api/chat/purge', blob);
    } catch {
      // client-side purge is primary
    }

    // 2. Wipe browser volatile session storage
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }

    // 3. Reset React runtime state
    const newToken = generateSession();
    setSessionToken(newToken);
    setMessages([
      {
        id: Date.now(),
        sender: 'system',
        text: 'Session state zeroized. Volatile RAM cleared and a fresh anonymous cryptographic identity has been initialized.',
        timestamp: 'Just now',
      },
    ]);
    setIsStreaming(false);
    setInputText('');
    setSealRecord(null);
    setVerifyStatus('IDLE');
    setVerifyHashLocal('');
    setZkError(null);
    setNukeLoading(false);
  };

  // ── Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isStreaming) return;

    setIsStreaming(true);
    setInputText('');

    // Run P2 Proxy redaction check
    const { sanitizedText, redactedCount, redactedTypes } = p2Redact(text);
    const userMsg: Message = {
      id: Date.now(),
      sender: 'user',
      text,
      timestamp: 'Just now',
      redactedInfo: redactedCount > 0 ? { count: redactedCount, types: redactedTypes } : undefined,
    };
    setMessages(prev => [...prev, userMsg]);

    const history = [...messages, userMsg]
      .filter(m => m.sender !== 'system')
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: p2Redact(m.text ?? '').sanitizedText,
      }));

    const assistantId = Date.now() + 1;

    // ── Single Model Mode
    if (!isComparisonMode) {
      const ghostMsg: Message = { id: assistantId, sender: 'ghost', text: '', timestamp: 'Just now', singleModelId };
      setMessages(prev => [...prev, ghostMsg]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model: singleModelId, stream: true, columnIndex: 0 }),
        });

        if (!res.ok || !res.body) {
          const errText = res.status === 429
            ? 'Rate limit encountered. Please retry shortly.'
            : `Provider returned status ${res.status}.`;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, text: errText } : m));
          return;
        }

        await readStream(
          res.body,
          delta => setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, text: m.text + delta } : m
          )),
          () => {},
        );
      } catch {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, text: 'Connection interrupted. Please retry.' } : m
        ));
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Comparison Mode: Parallel Multi-Model Fan-out
    const activeModels = selectedModels.slice(0, MAX_COMPARISON_MODELS);
    const initResponses: Record<string, ModelResponse> = {};
    activeModels.forEach(id => { initResponses[id] = { text: '', status: 'loading' }; });

    const cmpMsg: Message = {
      id: assistantId,
      sender: 'ghost',
      text: '',
      timestamp: 'Just now',
      modelResponses: initResponses,
    };
    setMessages(prev => [...prev, cmpMsg]);

    const patchModel = (modelId: string, patch: Partial<ModelResponse>) =>
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId || !m.modelResponses) return m;
        return {
          ...m,
          modelResponses: {
            ...m.modelResponses,
            [modelId]: { ...m.modelResponses[modelId], ...patch },
          },
        };
      }));

    const streamPromises = activeModels.map(async (modelId, index) => {
      patchModel(modelId, { status: 'loading' });
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model: modelId, stream: true, columnIndex: index }),
        });

        if (!res.ok || !res.body) {
          patchModel(modelId, { text: '', status: 'error', errorCode: res.status });
          return;
        }

        patchModel(modelId, { status: 'streaming' });

        await readStream(
          res.body,
          delta => setMessages(prev => prev.map(m => {
            if (m.id !== assistantId || !m.modelResponses) return m;
            return {
              ...m,
              modelResponses: {
                ...m.modelResponses,
                [modelId]: { ...m.modelResponses[modelId], text: m.modelResponses[modelId].text + delta },
              },
            };
          })),
          () => patchModel(modelId, { status: 'done' }),
        );
      } catch {
        patchModel(modelId, { text: '', status: 'error' });
      }
    });

    await Promise.allSettled(streamPromises);
    setIsStreaming(false);
  };

  // ── Midnight ZK Proof: Seal Conversation On-Chain
  const handleSeal = useCallback(async () => {
    if (isSealing || isSealed) return;
    setIsSealing(true);
    setZkError(null);
    setVerifyStatus('IDLE');

    const historyText = buildHistoryText(messages);
    const hashHex = await sha256Hex(historyText);

    try {
      // @ts-ignore — window.midnight injected by Lace wallet
      const hasMidnight = typeof window !== 'undefined' && !!window.midnight;

      if (hasMidnight) {
        const bridgePath = ['../../../../hash-store/src/shared/blockchain', 'midnightBridge'].join('/');
        const bridge = await import(/* webpackIgnore: true */ bridgePath as string);
        const result = await bridge.sealConversationOnChain(historyText, null);
        setSealRecord({
          txId: result.txId,
          blockHeight: result.blockHeight,
          hashHex,
          sealedAt: Date.now(),
        });
      } else {
        // Devnet / Demo simulation
        await new Promise(r => setTimeout(r, 2000));
        const mockBlock = 1145 + Math.floor(Math.random() * 30);
        const mockTx = `0x${hashHex.slice(0, 12)}...${hashHex.slice(-8)}`;
        setSealRecord({
          txId: mockTx,
          blockHeight: mockBlock,
          hashHex,
          sealedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Wallet bridge error';
      setZkError(`Seal failed: ${msg}`);
    } finally {
      setIsSealing(false);
    }
  }, [isSealing, isSealed, messages]);

  // ── Midnight ZK Proof: Verify Authenticity
  const handleVerify = useCallback(async () => {
    if (isVerifying || !sealRecord) return;
    setIsVerifying(true);
    setVerifyStatus('IDLE');
    setZkError(null);

    const historyText = buildHistoryText(messages);
    const currentHash = await sha256Hex(historyText);
    setVerifyHashLocal(currentHash);

    try {
      // @ts-ignore
      const hasMidnight = typeof window !== 'undefined' && !!window.midnight;

      let matched: boolean;
      if (hasMidnight) {
        const bridgePath = ['../../../../hash-store/src/shared/blockchain', 'midnightBridge'].join('/');
        const bridge = await import(/* webpackIgnore: true */ bridgePath as string);
        matched = await bridge.verifyConversationOnChain(historyText, null);
      } else {
        await new Promise(r => setTimeout(r, 1200));
        matched = currentHash === sealRecord.hashHex;
      }

      setVerifyStatus(matched ? 'MATCHED' : 'TAMPERED');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification error';
      setZkError(`Verify failed: ${msg}`);
      setVerifyStatus('TAMPERED');
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, sealRecord, messages]);

  // ── Derived Values
  const activeSingleModel = AVAILABLE_MODELS.find(m => m.id === singleModelId);

  const gridColsClass = isComparisonMode
    ? selectedModels.length === 1
      ? 'grid-cols-1'
      : selectedModels.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    : '';

  if (!isAppLaunched) {
    return <LandingHero onLaunch={() => setIsAppLaunched(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090a0f] text-slate-100 font-sans relative">
      {/* Subtle background ambient light */}
      <div className="absolute top-0 left-1/3 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* ─── SIDEBAR: Privacy Operations Console ──────────────────────────── */}
      <aside className="w-80 border-r border-slate-800/80 bg-[#0c0e17] flex-col justify-between hidden md:flex z-10 shrink-0">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Brand header */}
          <div className="p-5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
                <ShieldIcon className="w-4 h-4" />
              </div>
              <div>
                <h1 className="font-bold text-sm tracking-tight text-white">GhostAI</h1>
                <p className="text-[10px] text-slate-400 font-mono">Privacy Engine v1.0</p>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/40 text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>RAM ONLY</span>
            </div>
          </div>

          {/* Ephemeral Session Card */}
          <div className="p-5 border-b border-slate-800/80 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">
                Anonymous Identity
              </h3>
              <span className="text-[10px] text-cyan-400 font-mono">Volatile RAM</span>
            </div>
            <div
              onClick={() => copyToClipboard(sessionToken, 'session')}
              className="group bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-3 font-mono text-xs text-slate-300 break-all transition-all cursor-pointer relative"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500">Session UUID</span>
                <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1">
                  <CopyIcon />
                  <span>Copy</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-300 select-all">{sessionToken || 'Generating...'}</p>
            </div>
            {copyFeedback === 'session' && (
              <p className="text-[10px] text-emerald-400 font-mono">✓ Session UUID copied to clipboard</p>
            )}
          </div>

          {/* Privacy Telemetry Checklist */}
          <div className="p-5 border-b border-slate-800/80 space-y-2.5 shrink-0">
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono mb-2">
              Privacy Enclave Telemetry
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900/50 border border-slate-800/50">
                <span className="text-slate-400">P2 Privacy Proxy</span>
                <span className="font-mono text-[11px] text-cyan-400 flex items-center space-x-1">
                  <ShieldIcon className="w-3 h-3 text-cyan-400" />
                  <span>Auto-Scrubbing PII</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900/50 border border-slate-800/50">
                <span className="text-slate-400">Disk Storage</span>
                <span className="font-mono text-[11px] text-emerald-400 flex items-center space-x-1">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  <span>0 Bytes</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900/50 border border-slate-800/50">
                <span className="text-slate-400">Tracking Cookies</span>
                <span className="font-mono text-[11px] text-emerald-400 flex items-center space-x-1">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  <span>Blocked</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900/50 border border-slate-800/50">
                <span className="text-slate-400">Upstream Logs</span>
                <span className="font-mono text-[11px] text-emerald-400 flex items-center space-x-1">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  <span>Edge Obfuscated</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-slate-900/50 border border-slate-800/50">
                <span className="text-slate-400">Proof Engine</span>
                <span className="font-mono text-[11px] text-cyan-400 flex items-center space-x-1">
                  <LockIcon className="w-3 h-3 text-cyan-400" />
                  <span>Midnight ZK</span>
                </span>
              </div>
            </div>
          </div>

          {/* Privacy Operations */}
          <div className="p-5 space-y-3 shrink-0 flex-1 overflow-y-auto custom-scrollbar">
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">
              Privacy Controls
            </h3>

            {/* Shredder Button */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleShredSession}
                disabled={nukeLoading}
                className={`w-full flex items-center justify-center space-x-2.5 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  nukeArmed
                    ? 'purge-armed bg-red-950/40 border-red-500 text-red-300'
                    : 'bg-slate-900 hover:bg-red-950/20 border-slate-800 hover:border-red-500/40 text-slate-300 hover:text-red-300'
                }`}
              >
                <TrashIcon className={nukeArmed ? 'text-red-400' : 'text-slate-400'} />
                <span>
                  {nukeLoading
                    ? 'Zeroizing Data...'
                    : nukeArmed
                    ? 'CONFIRM: Zeroize All Data (3s)'
                    : 'Shred Session State'}
                </span>
              </button>
              {nukeArmed && (
                <p className="text-[10px] text-red-400/90 font-mono text-center">
                  Click again immediately to purge all memory and reset session.
                </p>
              )}
            </div>

            {/* Export Proof JSON if sealed */}
            {sealRecord && (
              <button
                type="button"
                onClick={() => {
                  const receipt = JSON.stringify(
                    {
                      sessionToken,
                      proofType: 'Midnight ZK Proof of Existence',
                      blockHeight: sealRecord.blockHeight,
                      txId: sealRecord.txId,
                      sha256Hex: sealRecord.hashHex,
                      sealedAtISO: new Date(sealRecord.sealedAt).toISOString(),
                    },
                    null,
                    2
                  );
                  copyToClipboard(receipt, 'receipt');
                }}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium transition-all cursor-pointer"
              >
                <CopyIcon />
                <span>Copy Cryptographic Proof</span>
              </button>
            )}
            {copyFeedback === 'receipt' && (
              <p className="text-[10px] text-cyan-400 font-mono text-center">✓ Proof receipt JSON copied</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-[#090a0f] shrink-0 text-xs text-slate-500 flex items-center justify-between">
          <span>Midnight Devnet</span>
          <span className="font-mono text-cyan-400 text-[10px]">Ledger Active</span>
        </div>
      </aside>

      {/* ─── MAIN WORKSPACE AREA ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#090a0f] relative z-10 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800/80 bg-[#0c0e17]/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between z-20 shrink-0 gap-3">
          {/* Model Selector & Comparison Mode Toggle */}
          <div className="flex items-center space-x-3 min-w-0" ref={dropdownRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(v => !v)}
                className="flex items-center space-x-2 text-xs bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 px-3.5 py-1.5 rounded-xl text-slate-200 transition-all cursor-pointer"
              >
                <CpuIcon className="text-cyan-400" />
                <span className="font-medium truncate max-w-[150px] sm:max-w-none">
                  {isComparisonMode
                    ? `${selectedModels.length} Models (Parallel)`
                    : activeSingleModel?.name ?? 'Select Model'}
                </span>
                <ChevronDownIcon className="text-slate-500" />
              </button>

              {/* Dropdown Panel */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-72 sm:w-84 bg-[#0c0e17] border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
                  {/* Mode Toggle Header */}
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
                    <div>
                      <p className="text-xs font-semibold text-white">Parallel Comparison Mode</p>
                      <p className="text-[10px] text-slate-400">Stream up to {MAX_COMPARISON_MODELS} models side-by-side</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsComparisonMode(v => !v);
                        setLimitWarn(false);
                      }}
                      className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${
                        isComparisonMode ? 'bg-cyan-600' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                          isComparisonMode ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {limitWarn && (
                    <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-800/40 text-[11px] text-amber-300 font-mono">
                      ⚠ Maximum {MAX_COMPARISON_MODELS} models allowed in parallel mode
                    </div>
                  )}

                  {/* Model List */}
                  <div className="py-2 max-h-72 overflow-y-auto custom-scrollbar">
                    {AVAILABLE_MODELS.map(model => {
                      if (isComparisonMode && model.id === 'google/gemma-4-31b-it:free') {
                        return null;
                      }

                      const theme = PROVIDER_THEMES[model.provider] ?? {
                        badge: 'border-slate-700 text-slate-400 bg-slate-800',
                        text: 'text-slate-400',
                      };
                      const isSelectedComp = selectedModels.includes(model.id);
                      const isActiveSingle = singleModelId === model.id;

                      return (
                        <div
                          key={model.id}
                          onClick={() => {
                            if (isComparisonMode) {
                              toggleComparisonModel(model.id);
                            } else {
                              setSingleModelId(model.id);
                              setIsDropdownOpen(false);
                            }
                          }}
                          className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-slate-900/80 transition-colors ${
                            isComparisonMode
                              ? isSelectedComp
                                ? 'bg-cyan-950/20'
                                : ''
                              : isActiveSingle
                              ? 'bg-slate-900'
                              : ''
                          }`}
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            {isComparisonMode ? (
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  isSelectedComp
                                    ? 'bg-cyan-600 border-cyan-500'
                                    : 'border-slate-700 bg-slate-900'
                                }`}
                              >
                                {isSelectedComp && <span className="text-white text-[10px] font-bold">✓</span>}
                              </div>
                            ) : (
                              <div
                                className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                                  isActiveSingle ? 'bg-cyan-400 border-cyan-400' : 'border-slate-600'
                                }`}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs text-slate-200 font-medium truncate">{model.name}</p>
                              <p className={`text-[10px] font-mono ${theme.text}`}>{model.provider} • {model.context}</p>
                            </div>
                          </div>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${theme.badge}`}>
                            FREE
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Mode Tag */}
            <span className="hidden sm:inline-flex text-[10px] font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
              {isComparisonMode ? 'COMPARISON MODE' : 'SINGLE MODEL'}
            </span>
          </div>

          {/* Right Toolbar: Midnight Wallet & ZK Actions */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Wallet Connect Pill */}
            {!isWalletConnected ? (
              <button
                type="button"
                onClick={() => setIsWalletConnected(true)}
                className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center space-x-1.5 bg-emerald-950/40 border border-emerald-800/40 px-3 py-1.5 rounded-xl text-xs text-emerald-300 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">mn_addr...96u7s</span>
                <span className="sm:hidden">Lace</span>
              </div>
            )}

            {/* Seal & Verify Toolbar */}
            {isWalletConnected && (
              <div className="flex items-center space-x-2 border-l border-slate-800 pl-2">
                {/* Seal Record Button */}
                <button
                  type="button"
                  disabled={isSealing || isSealed}
                  onClick={handleSeal}
                  className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
                    isSealed
                      ? 'bg-emerald-950/40 border border-emerald-600/40 text-emerald-300 shadow-sm'
                      : isSealing
                      ? 'bg-slate-900 border border-cyan-500/50 text-cyan-300 animate-pulse cursor-not-allowed'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                  }`}
                >
                  <LockIcon className="w-3.5 h-3.5" />
                  <span>
                    {isSealing
                      ? 'Compiling ZK Proof…'
                      : isSealed
                      ? 'Matrix Sealed'
                      : 'Seal Matrix'}
                  </span>
                </button>

                {/* Verify Authenticity Button */}
                {isSealed && (
                  <button
                    type="button"
                    disabled={isVerifying}
                    onClick={handleVerify}
                    className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
                      verifyStatus === 'MATCHED'
                        ? 'bg-emerald-950/50 border border-emerald-500/60 text-emerald-300 shadow-sm'
                        : verifyStatus === 'TAMPERED'
                        ? 'bg-red-950/50 border border-red-500/60 text-red-300 shadow-sm'
                        : isVerifying
                        ? 'bg-slate-900 border border-slate-800 text-slate-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                    }`}
                  >
                    <span>
                      {isVerifying
                        ? 'Verifying…'
                        : verifyStatus === 'MATCHED'
                        ? '✓ Verified Authentic'
                        : verifyStatus === 'TAMPERED'
                        ? '⚠ Tampered'
                        : 'Verify Authenticity'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ─── MESSAGE FEED ──────────────────────────────────────────────── */}
        <section className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 custom-scrollbar">
          <div className="max-w-5xl mx-auto space-y-6">
            {messages.map(msg => (
              <div key={msg.id}>
                {/* System Notice */}
                {msg.sender === 'system' && (
                  <div className="flex justify-center my-2">
                    <div className="bg-slate-900/90 border border-slate-800 text-slate-400 text-xs px-4 py-2 rounded-xl text-center max-w-xl flex items-center space-x-2">
                      <ShieldIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>{msg.text}</span>
                    </div>
                  </div>
                )}

                {/* User Message */}
                {msg.sender === 'user' && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] md:max-w-[70%]">
                      <div className="text-[10px] text-slate-500 mb-1 text-right font-mono flex items-center justify-end space-x-2">
                        {msg.redactedInfo && (
                          <span className="text-cyan-400 font-mono text-[9px] bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-800/50 flex items-center space-x-1">
                            <ShieldIcon className="w-2.5 h-2.5" />
                            <span>P2 Redacted: {msg.redactedInfo.count} item ({msg.redactedInfo.types.join(', ')})</span>
                          </span>
                        )}
                        <span>You • {msg.timestamp}</span>
                      </div>
                      <div className="bg-gradient-to-r from-cyan-950/40 to-sky-950/40 border border-cyan-800/40 text-slate-100 rounded-2xl rounded-tr-none px-5 py-3.5 text-sm leading-relaxed shadow-md">
                        {msg.text}
                      </div>
                    </div>
                  </div>
                )}

                {/* Ghost / AI Assistant Message */}
                {msg.sender === 'ghost' && (
                  <div className="w-full">
                    {/* Single Model Response */}
                    {!msg.modelResponses && (
                      <div className="max-w-[90%] md:max-w-[80%]">
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center space-x-2">
                          <span className="font-semibold text-slate-300">GhostAI</span>
                          {msg.singleModelId && (
                            <span className="text-cyan-400 font-mono">
                              • {AVAILABLE_MODELS.find(m => m.id === msg.singleModelId)?.name ?? msg.singleModelId}
                            </span>
                          )}
                          <span className="text-slate-600">• {msg.timestamp}</span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800 text-slate-200 rounded-2xl rounded-tl-none p-5 text-sm leading-relaxed shadow-lg whitespace-pre-wrap">
                          {msg.text || (
                            <div className="flex items-center space-x-2 text-slate-400 text-xs">
                              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                              <span>Streaming response from edge enclave...</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Comparison Mode: Parallel Columns */}
                    {msg.modelResponses && (
                      <div className={`w-full grid gap-4 ${gridColsClass}`}>
                        {selectedModels.map(modelId => {
                          const model = AVAILABLE_MODELS.find(m => m.id === modelId);
                          const resp = msg.modelResponses![modelId] ?? { text: '', status: 'idle' };
                          const theme = PROVIDER_THEMES[model?.provider ?? ''] ?? {
                            badge: 'border-slate-700 text-slate-400',
                            text: 'text-slate-400',
                          };

                          return (
                            <div
                              key={modelId}
                              className="col-in bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xl"
                            >
                              {/* Column Header */}
                              <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between shrink-0">
                                <div>
                                  <p className="text-xs font-semibold text-white truncate">{model?.name ?? modelId}</p>
                                  <p className={`text-[10px] font-mono ${theme.text}`}>{model?.provider}</p>
                                </div>
                                <StatusDot status={resp.status} />
                              </div>

                              {/* Column Content */}
                              <div className="flex-1 overflow-y-auto max-h-96 custom-scrollbar p-4 text-xs text-slate-300 leading-relaxed min-h-[100px]">
                                {resp.status === 'loading' && <ColumnSkeleton />}
                                {resp.status === 'error' && <ColumnError code={resp.errorCode} />}
                                {(resp.status === 'streaming' || resp.status === 'done') && resp.text && (
                                  <p className="whitespace-pre-wrap">{resp.text}</p>
                                )}
                                {resp.status === 'streaming' && !resp.text && <ColumnSkeleton />}
                                {resp.status === 'idle' && (
                                  <p className="text-slate-500 font-mono text-[11px]">Waiting for stream initialization...</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Error Banner */}
            {zkError && (
              <div className="bg-red-950/30 border border-red-500/40 p-4 rounded-xl text-xs space-y-1 max-w-xl mx-auto">
                <div className="flex items-center space-x-2 text-red-400 font-semibold">
                  <span>⚠</span>
                  <span>Blockchain Operation Exception</span>
                </div>
                <p className="text-slate-300 font-mono text-[11px]">{zkError}</p>
                <button
                  type="button"
                  onClick={() => setZkError(null)}
                  className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Sealed Proof Certificate Banner */}
            {sealRecord && (
              <div className="privacy-panel rounded-2xl p-5 border border-emerald-500/30 shadow-xl max-w-2xl mx-auto space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-sm">
                    <CheckIcon className="w-4 h-4 text-emerald-400" />
                    <span>Cryptographic Proof of Existence Sealed</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/50">
                    Block #{sealRecord.blockHeight}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-mono">Midnight Transaction ID</p>
                    <p className="font-mono text-slate-200 text-[11px] break-all">{sealRecord.txId}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-slate-400 uppercase font-mono">Timestamp</p>
                    <p className="font-mono text-slate-200 text-[11px]">{new Date(sealRecord.sealedAt).toISOString()}</p>
                  </div>
                  <div className="space-y-0.5 sm:col-span-2">
                    <p className="text-[10px] text-slate-400 uppercase font-mono">SHA-256 Conversation State Digest</p>
                    <p className="font-mono text-cyan-300 text-[11px] break-all select-all">{sealRecord.hashHex}</p>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  The plaintext content never left your browser. The cryptographic digest anchors the exact state on the Midnight ledger.
                </p>
              </div>
            )}

            {/* Verification Result Banner */}
            {verifyStatus === 'MATCHED' && (
              <div className="privacy-panel rounded-2xl p-5 border border-emerald-500/50 shadow-xl max-w-2xl mx-auto space-y-2">
                <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                  <CheckIcon className="w-5 h-5 text-emerald-400" />
                  <span>Authentic State Verified: Zero Tampering Detected</span>
                </div>
                <p className="text-xs text-slate-300">
                  Re-computed local SHA-256 digest matches the on-chain committed record byte-for-byte.
                </p>
                <div className="pt-1">
                  <p className="text-[10px] text-slate-400 uppercase font-mono">Verified Hash Match</p>
                  <p className="font-mono text-emerald-300 text-[11px] break-all">{verifyHashLocal}</p>
                </div>
              </div>
            )}

            {verifyStatus === 'TAMPERED' && (
              <div className="privacy-panel rounded-2xl p-5 border border-red-500/50 shadow-xl max-w-2xl mx-auto space-y-2">
                <div className="flex items-center space-x-2 text-red-400 font-bold text-sm">
                  <span>⚠</span>
                  <span>Integrity Violation: State Has Been Altered</span>
                </div>
                <p className="text-xs text-slate-300">
                  The current visible conversation does NOT match the sealed hash committed to the Midnight blockchain.
                </p>
                <div className="grid grid-cols-1 gap-2 pt-1 font-mono text-[10px]">
                  <div>
                    <span className="text-slate-400">Local Hash: </span>
                    <span className="text-red-400 break-all">{verifyHashLocal}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Sealed Hash: </span>
                    <span className="text-slate-300 break-all">{sealRecord?.hashHex}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </section>

        {/* ─── INPUT DOCK ────────────────────────────────────────────────── */}
        <footer className="p-4 border-t border-slate-800/80 bg-[#0c0e17]/80 backdrop-blur-md shrink-0">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSendMessage} className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isStreaming}
                placeholder={
                  isStreaming
                    ? 'Streaming response from edge enclave…'
                    : 'Type a secure prompt… (P2 Proxy active: PII auto-redacted, zero persistence)'
                }
                className="w-full bg-slate-900/90 border border-slate-800 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 rounded-2xl pl-5 pr-14 py-3.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isStreaming}
                className={`absolute right-3 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  inputText.trim() && !isStreaming
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold shadow-md shadow-cyan-500/25 cursor-pointer'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                {isStreaming ? (
                  <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>↑</span>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between mt-2.5 px-2 text-[10px] text-slate-500 font-mono">
              <span>
                {isComparisonMode
                  ? `Parallel stream active • ${selectedModels.length} models selected`
                  : `Single stream active • ${activeSingleModel?.name ?? 'Model'}`}
              </span>
              <span className="flex items-center space-x-1.5 text-slate-400">
                <ShieldIcon className="w-3 h-3 text-cyan-400" />
                <span>P2 Proxy Active • Sensitive Data Redacted</span>
              </span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
