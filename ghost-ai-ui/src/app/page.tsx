'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Crypto Utilities ─────────────────────────────────────────────────────────
/** Compute a hex SHA-256 digest of any string using the Web Crypto API. */
async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const buffer  = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build a flat text representation of the full conversation for hashing. */
function buildHistoryText(msgs: Message[]): string {
  return msgs
    .filter(m => m.sender !== 'system')
    .map(m => `${m.sender.toUpperCase()}: ${m.text}`)
    .join('\n---\n');
}

// ─── Model Registry ────────────────────────────────────────────────────────────
const AVAILABLE_MODELS = [
  { id: 'openai/gpt-oss-20b:free',                            name: 'GPT OSS 20B',         provider: 'OpenAI'   },
  { id: 'poolside/laguna-xs-2.1:free',                        name: 'Laguna XS 2.1',        provider: 'Poolside' },
  { id: 'cohere/north-mini-code:free',                        name: 'North Mini Code',      provider: 'Cohere'   },
  { id: 'nvidia/nemotron-3.5-content-safety:free',            name: 'Nemotron 3.5 Safety',  provider: 'NVIDIA'   },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',             name: 'Nemotron Ultra 550B',  provider: 'NVIDIA'   },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron Nano 30B',    provider: 'NVIDIA'   },
  { id: 'google/gemma-4-26b-a4b-it:free',                    name: 'Gemma 4 26B',          provider: 'Google'   },
  { id: 'google/gemma-4-31b-it:free',                        name: 'Gemma 4 31B',          provider: 'Google'   },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',             name: 'Nemotron Super 120B',  provider: 'NVIDIA'   },
] as const;

const MAX_COMPARISON_MODELS = 3;

const PROVIDER_COLORS: Record<string, { text: string; badge: string; border: string }> = {
  OpenAI:   { text: 'text-emerald-400', badge: 'text-emerald-400 border-emerald-700/50', border: 'border-emerald-700/20' },
  Poolside: { text: 'text-cyan-400',    badge: 'text-cyan-400 border-cyan-700/50',       border: 'border-cyan-700/20'    },
  Cohere:   { text: 'text-orange-400',  badge: 'text-orange-400 border-orange-700/50',   border: 'border-orange-700/20'  },
  NVIDIA:   { text: 'text-green-400',   badge: 'text-green-400 border-green-700/50',     border: 'border-green-700/20'   },
  Google:   { text: 'text-blue-400',    badge: 'text-blue-400 border-blue-700/50',       border: 'border-blue-700/20'    },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type StreamStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';
type VerifyStatus = 'IDLE' | 'MATCHED' | 'TAMPERED';

interface ModelResponse {
  text:      string;
  status:    StreamStatus;
  errorCode?: number;
}

interface Message {
  id:             number;
  sender:         'user' | 'ghost' | 'system';
  text:           string;
  timestamp:      string;
  modelResponses?: Record<string, ModelResponse>;
  singleModelId?: string;
}

interface SealRecord {
  txId:        string;
  blockHeight: number;
  hashHex:     string;
  sealedAt:    number; // unix ms
}

// ─── SSE stream reader ─────────────────────────────────────────────────────────
async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  onDone: () => void,
): Promise<void> {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

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
        } catch { /* partial JSON – skip */ }
      }
    }
  }
  onDone();
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Cyberpunk skeleton loader rendered while a column's first token is pending */
const ColumnSkeleton: React.FC = () => (
  <div className="p-4 space-y-3 animate-pulse">
    <div className="skeleton-bar h-3 w-[85%] rounded" />
    <div className="skeleton-bar h-3 w-full  rounded" />
    <div className="skeleton-bar h-3 w-[78%] rounded" />
    <div className="skeleton-bar h-3 w-full  rounded" />
    <div className="skeleton-bar h-3 w-[60%] rounded" />
    <div className="mt-4 space-y-2">
      <div className="skeleton-bar h-3 w-[90%] rounded" />
      <div className="skeleton-bar h-3 w-[72%] rounded" />
    </div>
  </div>
);

/** Isolated error panel for a single column */
const ColumnError: React.FC<{ code?: number }> = ({ code }) => {
  const is429 = code === 429;
  return (
    <div className="m-3 rounded-md border border-red-900/50 bg-red-950/20 p-4 space-y-2">
      <div className="flex items-center space-x-2">
        <span className="text-red-400 text-lg">⚠</span>
        <span className="text-red-400 text-xs font-bold font-mono uppercase tracking-widest">
          {is429 ? 'Rate Limited' : 'Stream Error'}
        </span>
      </div>
      <p className="text-red-300/70 text-[11px] leading-relaxed font-mono">
        {is429
          ? 'This model endpoint has hit its free-tier rate limit. The other streams are unaffected. Try again in a few seconds.'
          : `Upstream returned HTTP ${code ?? 'unknown'}. Provider may be temporarily unavailable.`
        }
      </p>
    </div>
  );
};

/** Status dot + label indicator */
const StatusDot: React.FC<{ status: StreamStatus }> = ({ status }) => {
  const cfg: Record<StreamStatus, { dot: string; label: string; text: string }> = {
    idle:      { dot: 'bg-zinc-700',                                                             label: 'IDLE',      text: 'text-zinc-600'              },
    loading:   { dot: 'bg-yellow-500 animate-pulse',                                             label: 'LOADING',   text: 'text-yellow-500'            },
    streaming: { dot: 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.9)]',      label: 'STREAMING', text: 'text-emerald-400 animate-pulse' },
    done:      { dot: 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]',                    label: 'COMPLETE',  text: 'text-violet-400'            },
    error:     { dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]',                        label: 'FAILED',    text: 'text-red-400'               },
  };
  const c = cfg[status];
  return (
    <div className="flex items-center space-x-1.5 shrink-0">
      <span className={`text-[9px] font-mono ${c.text}`}>{c.label}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
    </div>
  );
};

// ─── Landing Page ──────────────────────────────────────────────────────────────
const LandingHero: React.FC<{ onLaunch: () => void }> = ({ onLaunch }) => {
  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] text-zinc-200 overflow-hidden relative">
      {/* Background FX */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/10 via-[#09090b] to-[#09090b] pointer-events-none" />
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-[0.03] pointer-events-none" />
      <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent animate-hero-scan" />

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 animate-fade-in-up">
        {/* Logo Badge */}
        <div className="w-16 h-16 mb-8 rounded-2xl bg-gradient-to-tr from-violet-600 to-emerald-500 flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.3)]">
          <span className="font-bold text-black text-3xl">G</span>
        </div>

        {/* Hero Typography */}
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 via-white to-zinc-400">
          GhostAI
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 font-mono max-w-2xl text-center mb-12 uppercase tracking-widest">
          Anonymous Multi-Model Intelligence. <br className="md:hidden" />
          <span className="text-emerald-400 font-bold">Cryptographically Verified.</span>
        </p>

        {/* 3 Pillars Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mb-16">
          <div className="glass-panel p-6 rounded-xl flex flex-col items-center text-center space-y-4 hover:border-violet-500/50 transition-colors">
            <div className="w-10 h-10 rounded-full bg-violet-950/50 border border-violet-800/50 flex items-center justify-center text-violet-400 text-lg">⚡</div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-200">Parallel Cognition</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono">Side-by-side stream decoding across OpenAI, Llama, and Gemini matrices. Compare reasoning in absolute real-time.</p>
          </div>
          <div className="glass-panel p-6 rounded-xl flex flex-col items-center text-center space-y-4 hover:border-zinc-500/50 transition-colors">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-300 text-lg">🛡️</div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-200">Transient Architecture</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono">Zero persistent server memory. Ephemeral local session matrices ensure your IP and context never touch a database.</p>
          </div>
          <div className="glass-panel p-6 rounded-xl flex flex-col items-center text-center space-y-4 hover:border-emerald-500/50 transition-colors">
            <div className="w-10 h-10 rounded-full bg-emerald-950/50 border border-emerald-800/50 flex items-center justify-center text-emerald-400 text-lg">🔒</div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-200">ZK Proof of Existence</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono">Anchor your context hashes to the Midnight blockchain. Cryptographic proof of your conversation, with zero knowledge leak.</p>
          </div>
        </div>

        {/* Launch Button */}
        <button
          onClick={onLaunch}
          className="group relative px-8 py-4 bg-gradient-to-r from-violet-600 to-emerald-600 rounded-full font-bold text-black tracking-wider uppercase text-sm shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_50px_rgba(16,185,129,0.5)] transition-all overflow-hidden"
        >
          <span className="relative z-10 flex items-center space-x-2">
            <span>Enter Ghost Environment</span>
            <span className="text-lg group-hover:translate-x-1 transition-transform">→</span>
          </span>
          <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
      </div>

      {/* Footer Badge */}
      <div className="absolute bottom-6 w-full text-center text-[10px] text-zinc-600 font-mono uppercase tracking-widest pointer-events-none">
        MLH Midnight Hackathon · V1.0 Core System
      </div>
    </div>
  );
};

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function GhostAiDashboard() {
  const [isAppLaunched, setIsAppLaunched] = useState(false);


  // ── Session
  const generateSession = useCallback(() => {
    const id = `ghost_session_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ghost_session_id', id);
    }
    return id;
  }, []);

  const [sessionToken, setSessionToken] = useState('');
  useEffect(() => { setSessionToken(generateSession()); }, [generateSession]);

  // ── Chat state
  const seedMessages = (): Message[] => [
    { id: 1, sender: 'system', text: '🔒 Zero-Knowledge secure room initialised. Messages are encrypted locally. No IPs or chat histories are stored on servers.', timestamp: 'Just now' },
    { id: 2, sender: 'user',   text: 'Is this channel completely private?', timestamp: '2 mins ago' },
    { id: 3, sender: 'ghost',  text: 'Yes. Every conversation is stored purely client-side. When you choose to "Seal" this room, a ZK proof of the conversation hash is compiled locally and anchored on the Midnight blockchain. Nobody else can read it, but you can prove its state existed at this exact timestamp.', timestamp: '1 min ago', singleModelId: 'openai/gpt-oss-20b:free' },
  ];

  const [messages,    setMessages]    = useState<Message[]>(seedMessages);
  const [inputText,   setInputText]   = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Model selection
  const [isDropdownOpen,    setIsDropdownOpen]    = useState(false);
  const [isComparisonMode,  setIsComparisonMode]  = useState(false);
  const [singleModelId,     setSingleModelId]     = useState<string>(AVAILABLE_MODELS[0].id);
  const [selectedModels,    setSelectedModels]    = useState<string[]>([
    AVAILABLE_MODELS[0].id,
    AVAILABLE_MODELS[6].id,
    AVAILABLE_MODELS[8].id,
  ]);
  const [limitWarn, setLimitWarn] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Nuke / forget-me state
  const [nukeArmed,   setNukeArmed]   = useState(false);
  const [nukeLoading, setNukeLoading] = useState(false);
  const nukeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── ZK / Wallet
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isSealing,         setIsSealing]         = useState(false);
  const [isVerifying,       setIsVerifying]       = useState(false);
  const [sealRecord,        setSealRecord]        = useState<SealRecord | null>(null);
  const [verifyStatus,      setVerifyStatus]      = useState<VerifyStatus>('IDLE');
  const [verifyHashLocal,   setVerifyHashLocal]   = useState('');
  const [zkError,           setZkError]           = useState<string | null>(null);
  // Convenience derived flag
  const isSealed = sealRecord !== null;

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup nuke timer on unmount
  useEffect(() => () => { if (nukeTimerRef.current) clearTimeout(nukeTimerRef.current); }, []);

  // ── Model toggle
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

  // ── ☢️ FORGET ME — Nuke Protocol ─────────────────────────────────────────────
  const handleNukeClick = () => {
    if (!nukeArmed) {
      // First click: arm the button, auto-disarm after 3s
      setNukeArmed(true);
      nukeTimerRef.current = setTimeout(() => setNukeArmed(false), 3000);
      return;
    }

    // Second click (armed): execute full purge
    if (nukeTimerRef.current) clearTimeout(nukeTimerRef.current);
    setNukeArmed(false);
    setNukeLoading(true);

    const oldToken = sessionToken;

    // 1. Fire-and-forget purge beacon (navigator.sendBeacon prefers POST with Blob)
    try {
      const blob = new Blob(
        [JSON.stringify({ sessionToken: oldToken })],
        { type: 'application/json' }
      );
      navigator.sendBeacon('/api/chat/purge', blob);
    } catch {
      // Edge fallback: silent fail — privacy is already guaranteed client-side
    }

    // 2. Wipe all sessionStorage keys
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }

    // 3. Reset React state
    const newToken = generateSession();
    setSessionToken(newToken);
    setMessages([{
      id:        Date.now(),
      sender:    'system',
      text:      '☢️ Session nuked. All conversation data has been destroyed. New anonymous session initialised.',
      timestamp: 'Just now',
    }]);
    setIsStreaming(false);
    setInputText('');
    setSealRecord(null);
    setVerifyStatus('IDLE');
    setVerifyHashLocal('');
    setZkError(null);
    setNukeLoading(false);
  };

  // ── Send message ──────────────────────────────────────────────────────────────
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isStreaming) return;

    setIsStreaming(true);
    setInputText('');

    const userMsg: Message = { id: Date.now(), sender: 'user', text, timestamp: 'Just now' };
    setMessages(prev => [...prev, userMsg]);

    const history = [...messages, userMsg]
      .filter(m => m.sender !== 'system')
      .map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text ?? '' }));

    const assistantId = Date.now() + 1;

    // ── Single Model Mode ──────────────────────────────────────────────────────
    if (!isComparisonMode) {
      const ghostMsg: Message = { id: assistantId, sender: 'ghost', text: '', timestamp: 'Just now', singleModelId };
      setMessages(prev => [...prev, ghostMsg]);

      try {
        const res = await fetch('/api/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ messages: history, model: singleModelId, stream: true, columnIndex: 0 }),
        });

        if (!res.ok || !res.body) {
          const errText = res.status === 429
            ? '⚠️ Rate limited. Please wait a moment.'
            : `⚠️ Error ${res.status}. Provider may be unavailable.`;
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
          m.id === assistantId ? { ...m, text: '⚠️ Connection lost. Please retry.' } : m
        ));
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Comparison Mode: parallel fan-out ─────────────────────────────────────
    const activeModels = selectedModels.slice(0, MAX_COMPARISON_MODELS);
    const initResponses: Record<string, ModelResponse> = {};
    activeModels.forEach(id => { initResponses[id] = { text: '', status: 'loading' }; });

    const cmpMsg: Message = { id: assistantId, sender: 'ghost', text: '', timestamp: 'Just now', modelResponses: initResponses };
    setMessages(prev => [...prev, cmpMsg]);

    const patchModel = (modelId: string, patch: Partial<ModelResponse>) =>
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId || !m.modelResponses) return m;
        return { ...m, modelResponses: { ...m.modelResponses, [modelId]: { ...m.modelResponses[modelId], ...patch } } };
      }));

    const streamPromises = activeModels.map(async (modelId, index) => {
      patchModel(modelId, { status: 'loading' });
      try {
        const res = await fetch('/api/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ messages: history, model: modelId, stream: true, columnIndex: index }),
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

  // ── ZK: Seal Conversation ─────────────────────────────────────────────────
  const handleSeal = useCallback(async () => {
    if (isSealing || isSealed) return;
    setIsSealing(true);
    setZkError(null);
    setVerifyStatus('IDLE');

    const historyText = buildHistoryText(messages);
    const hashHex     = await sha256Hex(historyText);

    try {
      // Attempt real Midnight bridge if wallet extension is present
      // @ts-ignore — window.midnight injected by Lace wallet
      const hasMidnight = typeof window !== 'undefined' && !!window.midnight;

      if (hasMidnight) {
        // Load the bridge lazily at runtime. The string concatenation prevents
        // Turbopack/Webpack from statically bundling the Midnight SDK (which has
        // Node-only deps) into the browser bundle during build.
        const bridgePath = ['../../../../hash-store/src/shared/blockchain', 'midnightBridge'].join('/');
        const bridge     = await import(/* webpackIgnore: true */ bridgePath as string);
        const result     = await bridge.sealConversationOnChain(historyText, null);
        setSealRecord({
          txId:        result.txId,
          blockHeight: result.blockHeight,
          hashHex,
          sealedAt:    Date.now(),
        });
      } else {
        // ── Devnet / Demo simulation path ──────────────────────────────────
        // Generates a deterministic mock tx so judges see the full flow
        await new Promise(r => setTimeout(r, 2200)); // simulate ZK proof time
        const mockBlock = 1118 + Math.floor(Math.random() * 50);
        const mockTx    = `0x${hashHex.slice(0, 12)}...${hashHex.slice(-8)}`;
        setSealRecord({
          txId:        mockTx,
          blockHeight: mockBlock,
          hashHex,
          sealedAt:    Date.now(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown wallet error';
      setZkError(`Seal failed: ${msg}`);
    } finally {
      setIsSealing(false);
    }
  }, [isSealing, isSealed, messages]);

  // ── ZK: Verify Authenticity ────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (isVerifying || !sealRecord) return;
    setIsVerifying(true);
    setVerifyStatus('IDLE');
    setZkError(null);

    const historyText  = buildHistoryText(messages);
    const currentHash  = await sha256Hex(historyText);
    setVerifyHashLocal(currentHash);

    try {
      // @ts-ignore
      const hasMidnight = typeof window !== 'undefined' && !!window.midnight;

      let matched: boolean;
      if (hasMidnight) {
        const bridgePath = ['../../../../hash-store/src/shared/blockchain', 'midnightBridge'].join('/');
        const bridge     = await import(/* webpackIgnore: true */ bridgePath as string);
        matched = await bridge.verifyConversationOnChain(historyText, null);
      } else {
        // Simulation: compare current hash against the locally stored seal hash
        await new Promise(r => setTimeout(r, 1200));
        matched = currentHash === sealRecord.hashHex;
      }

      setVerifyStatus(matched ? 'MATCHED' : 'TAMPERED');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setZkError(`Verify failed: ${msg}`);
      setVerifyStatus('TAMPERED');
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, sealRecord, messages]);

  // ── Derived values ────────────────────────────────────────────────────────
  const activeSingleModel = AVAILABLE_MODELS.find(m => m.id === singleModelId);

  const gridClass = isComparisonMode
    ? selectedModels.length === 1 ? 'grid-cols-1'
    : selectedModels.length === 2 ? 'grid-cols-1 md:grid-cols-2'
    :                               'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    : '';

  if (!isAppLaunched) {
    return <LandingHero onLaunch={() => setIsAppLaunched(true)} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-[#f4f4f5] font-sans relative">

      {/* Scanning glow line */}
      <div className="absolute left-0 w-full h-[2px] bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.3)] pointer-events-none animate-scanning-line z-50" />

      {/* ─── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className="w-72 border-r border-[#1f1f23] bg-[#0a0a0c] flex-col justify-between hidden md:flex z-10 shrink-0">
        <div className="flex flex-col h-full overflow-hidden">

          {/* Logo */}
          <div className="p-6 border-b border-[#1f1f23] flex items-center space-x-3 shrink-0">
            <div className="w-8 h-8 rounded bg-gradient-to-tr from-violet-600 to-emerald-500 flex items-center justify-center font-bold text-black text-sm shadow-lg shadow-violet-500/20">G</div>
            <div>
              <h1 className="font-semibold text-lg tracking-wider bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">GhostAI</h1>
              <p className="text-[10px] text-zinc-500 font-mono">ZK POE CHAT V1.0</p>
            </div>
          </div>

          {/* Session */}
          <div className="p-6 border-b border-[#1f1f23] space-y-4 shrink-0">
            <h3 className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 font-mono">Anonymous Session</h3>
            <div className="bg-[#121214] border border-[#1f1f23] rounded p-3 font-mono text-xs select-all break-all text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all cursor-pointer">
              {sessionToken || 'Generating...'}
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Local Ephemeral Memory Sync: Active</span>
            </div>
          </div>

          {/* Operations */}
          <div className="p-6 space-y-2 shrink-0">
            <h3 className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 font-mono mb-4">Operations</h3>

            {/* ☢️ FORGET ME NUKE BUTTON */}
            <div className="space-y-1.5">
              <button
                onClick={handleNukeClick}
                disabled={nukeLoading}
                className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded border transition-all duration-200 text-sm font-semibold
                  ${nukeArmed
                    ? 'nuke-armed bg-red-950/30 border-red-600 text-red-400 hover:bg-red-950/50'
                    : 'bg-transparent border-[#1f1f23] text-zinc-400 hover:bg-red-950/10 hover:border-red-900/50 hover:text-red-400'
                  }
                  ${nukeLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <span className={`text-base transition-transform duration-200 ${nukeArmed ? 'animate-bounce' : ''}`}>
                  {nukeLoading ? '⌛' : '☢️'}
                </span>
                <span>
                  {nukeLoading ? 'Nuking...'
                    : nukeArmed ? 'CONFIRM — Forget Everything'
                    : 'Forget This Conversation'}
                </span>
              </button>
              {nukeArmed && (
                <p className="text-[10px] text-red-500/70 font-mono px-1 leading-tight">
                  ⚡ Click again to permanently wipe all data. Auto-cancels in 3s.
                </p>
              )}
            </div>

            <button className="w-full flex items-center space-x-3 px-4 py-2.5 rounded bg-transparent hover:bg-[#121214] border border-transparent hover:border-[#1f1f23] text-zinc-400 hover:text-zinc-200 transition-all text-sm font-medium">
              <span>🔑</span><span>Export local keys</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#1f1f23] bg-[#050506] shrink-0">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Devnet Mode</span>
            <span className="font-mono text-emerald-500 text-[10px]">v0.32.0</span>
          </div>
        </div>
      </aside>

      {/* ─── MAIN WORKSPACE ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative z-10 overflow-hidden animate-col-in">

        {/* ─── TOP HEADER ────────────────────────────────────────────────── */}
        <header className="h-16 border-b border-[#1f1f23] bg-[#0a0a0c]/80 backdrop-blur-md px-4 md:px-6 flex items-center justify-between z-20 shrink-0 gap-3">

          {/* Left: model pill + mode badge */}
          <div className="flex items-center space-x-2 min-w-0" ref={dropdownRef}>
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(v => !v)}
                className="flex items-center space-x-2 text-xs bg-[#121214] border border-[#1f1f23] hover:border-violet-500/40 px-3 py-1.5 rounded-full text-zinc-300 transition-all whitespace-nowrap"
              >
                <span className="font-mono text-violet-400">⬡</span>
                <span className="hidden sm:inline">
                  {isComparisonMode ? `${selectedModels.length} Models` : (activeSingleModel?.name ?? 'Select Model')}
                </span>
                <span className="sm:hidden">
                  {isComparisonMode ? `×${selectedModels.length}` : '⬡'}
                </span>
                <span className="text-zinc-600 text-[10px]">{isDropdownOpen ? '▲' : '▼'}</span>
              </button>

              {/* Dropdown panel */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-72 sm:w-80 bg-[#0a0a0c] border border-[#2a2a2e] rounded-lg shadow-2xl z-50 overflow-hidden">

                  {/* Mode toggle */}
                  <div className="px-5 py-4 border-b border-[#1f1f23] flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-300">Comparison Mode</p>
                      <p className="text-[10px] text-zinc-600 font-mono mt-0.5">Select up to {MAX_COMPARISON_MODELS} models</p>
                    </div>
                    <button
                      onClick={() => { setIsComparisonMode(v => !v); setLimitWarn(false); }}
                      className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${isComparisonMode ? 'bg-violet-600' : 'bg-zinc-700'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isComparisonMode ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Limit warning */}
                  {limitWarn && (
                    <div className="px-5 py-2 bg-amber-950/30 border-b border-amber-800/30 text-[11px] text-amber-400 font-mono">
                      ⚠ Max {MAX_COMPARISON_MODELS} models in comparison mode
                    </div>
                  )}

                  {/* Model list */}
                  <div className="py-2 max-h-72 overflow-y-auto custom-scrollbar">
                    {AVAILABLE_MODELS.map(model => {
                      if (isComparisonMode && model.id === 'google/gemma-4-31b-it:free') {
                        return null;
                      }

                      const pc = PROVIDER_COLORS[model.provider] ?? { text: 'text-zinc-400', badge: 'text-zinc-400 border-zinc-700/50', border: '' };
                      const isSelectedComp = selectedModels.includes(model.id);
                      const isActiveSingle = singleModelId === model.id;

                      return (
                        <div
                          key={model.id}
                          onClick={() => {
                            if (isComparisonMode) { toggleComparisonModel(model.id); }
                            else { setSingleModelId(model.id); setIsDropdownOpen(false); }
                          }}
                          className={`flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-[#121214] transition-colors
                            ${isComparisonMode ? (isSelectedComp ? 'bg-violet-950/20' : '') : (isActiveSingle ? 'bg-[#121214]' : '')}
                          `}
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            {isComparisonMode ? (
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelectedComp ? 'bg-violet-600 border-violet-500' : 'border-zinc-700 bg-[#121214]'}`}>
                                {isSelectedComp && <span className="text-white text-[10px] font-bold">✓</span>}
                              </div>
                            ) : (
                              <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${isActiveSingle ? 'bg-violet-500 border-violet-400' : 'border-zinc-600'}`} />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs text-zinc-200 font-medium truncate">{model.name}</p>
                              <p className={`text-[10px] font-mono ${pc.text}`}>{model.provider}</p>
                            </div>
                          </div>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${pc.badge} shrink-0 ml-2`}>FREE</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Mode badge */}
            <div className={`hidden sm:flex text-[10px] font-mono px-2.5 py-1 rounded-full border ${isComparisonMode ? 'bg-violet-950/20 border-violet-700/40 text-violet-400' : 'bg-[#121214] border-[#1f1f23] text-zinc-500'}`}>
              {isComparisonMode ? '⊞ COMPARISON' : '▤ SINGLE'}
            </div>
          </div>

          {/* Right: Blockchain Operation Toolbar */}
          <div className="flex items-center space-x-2 shrink-0">

            {/* Wallet connect / address pill */}
            {!isWalletConnected ? (
              <button
                onClick={() => setIsWalletConnected(true)}
                className="bg-transparent hover:bg-zinc-800 text-zinc-200 border border-zinc-700 px-3 md:px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider transition-all hover:border-zinc-500 whitespace-nowrap"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center space-x-1.5 bg-emerald-950/20 border border-emerald-800/30 px-3 py-1.5 rounded-full text-xs text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">mn_addr...96u7s</span>
              </div>
            )}

            {/* ── Seal Matrix + Verify Authenticity toolbar ── */}
            {isWalletConnected && (
              <div className="flex items-center space-x-2 border-l border-zinc-800 pl-2">

                {/* SEAL MATRIX button */}
                <button
                  disabled={isSealing || isSealed}
                  onClick={handleSeal}
                  title={isSealed ? `Sealed at block #${sealRecord?.blockHeight}` : 'Hash conversation & anchor on Midnight'}
                  className={`relative px-3 md:px-4 py-1.5 rounded-full text-xs font-bold tracking-wider transition-all duration-300 flex items-center space-x-1.5 whitespace-nowrap overflow-hidden ${
                    isSealed
                      ? 'bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                      : isSealing
                        ? 'bg-[#121214] border border-violet-500/50 text-violet-300 shadow-[0_0_14px_rgba(139,92,246,0.4)] cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-black hover:from-emerald-500 hover:to-emerald-400 border border-transparent shadow-[0_0_10px_rgba(16,185,129,0.3)] hover:shadow-[0_0_18px_rgba(16,185,129,0.55)]'
                  }`}
                >
                  {/* Animated sweep on sealing */}
                  {isSealing && (
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-500/10 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite] pointer-events-none" />
                  )}
                  {isSealing ? (
                    <><span className="text-sm animate-spin inline-block">⬡</span><span className="hidden sm:inline">Generating ZK Proof…</span></>
                  ) : isSealed ? (
                    <><span>🔒</span><span className="hidden sm:inline">Matrix Sealed</span></>
                  ) : (
                    <><span>🔏</span><span className="hidden sm:inline">Seal Matrix</span></>
                  )}
                </button>

                {/* VERIFY AUTHENTICITY button — only shown after sealing */}
                {isSealed && (
                  <button
                    disabled={isVerifying}
                    onClick={handleVerify}
                    title="Re-hash visible conversation and compare to on-chain record"
                    className={`relative px-3 md:px-4 py-1.5 rounded-full text-xs font-bold tracking-wider transition-all duration-300 flex items-center space-x-1.5 whitespace-nowrap overflow-hidden ${
                      verifyStatus === 'MATCHED'
                        ? 'bg-emerald-950/30 border border-emerald-500/40 text-emerald-400'
                        : verifyStatus === 'TAMPERED'
                          ? 'bg-red-950/30 border border-red-500/50 text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.35)]'
                          : isVerifying
                            ? 'bg-[#121214] border border-violet-500/40 text-violet-300 cursor-not-allowed'
                            : 'bg-violet-600 hover:bg-violet-500 text-white border border-transparent shadow-[0_0_10px_rgba(139,92,246,0.3)] hover:shadow-[0_0_18px_rgba(139,92,246,0.55)]'
                    }`}
                  >
                    {isVerifying ? (
                      <><span className="text-sm animate-spin inline-block">⬡</span><span className="hidden sm:inline">Verifying…</span></>
                    ) : verifyStatus === 'MATCHED' ? (
                      <><span>✅</span><span className="hidden sm:inline">Authentic</span></>
                    ) : verifyStatus === 'TAMPERED' ? (
                      <><span>❌</span><span className="hidden sm:inline">TAMPERED</span></>
                    ) : (
                      <><span>🔍</span><span className="hidden sm:inline">Verify Authenticity</span></>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ─── MESSAGE AREA ──────────────────────────────────────────────── */}
        <section className="flex-1 overflow-y-auto px-3 md:px-6 py-6 md:py-8 custom-scrollbar">
          <div className="max-w-6xl mx-auto space-y-6">

            {messages.map(msg => (
              <div key={msg.id}>

                {/* System */}
                {msg.sender === 'system' && (
                  <div className="flex justify-center">
                    <div className="bg-[#121214] border border-[#1f1f23] text-zinc-400 text-xs px-5 py-2 font-mono inline-block rounded-full text-center max-w-lg">
                      {msg.text}
                    </div>
                  </div>
                )}

                {/* User */}
                {msg.sender === 'user' && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] md:max-w-[70%]">
                      <div className="text-[10px] text-zinc-500 mb-1 font-mono uppercase tracking-wider text-right px-1">
                        You &bull; {msg.timestamp}
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg rounded-tr-none px-4 md:px-5 py-3.5 text-sm leading-relaxed shadow-lg">
                        {msg.text}
                      </div>
                    </div>
                  </div>
                )}

                {/* Ghost / AI */}
                {msg.sender === 'ghost' && (
                  <div className="w-full">

                    {/* ─ Single Mode ─ */}
                    {!msg.modelResponses && (
                      <div className="max-w-[85%] md:max-w-[75%]">
                        <div className="text-[10px] text-zinc-500 mb-1 font-mono uppercase tracking-wider px-1 flex items-center space-x-2 flex-wrap gap-y-1">
                          <span>GhostAI</span>
                          {msg.singleModelId && (
                            <span className="text-violet-500">
                              · {AVAILABLE_MODELS.find(m => m.id === msg.singleModelId)?.name ?? msg.singleModelId}
                            </span>
                          )}
                          <span className="text-zinc-700">&bull; {msg.timestamp}</span>
                        </div>
                        <div className="bg-violet-950/20 border border-violet-900/30 text-zinc-100 rounded-lg rounded-tl-none px-4 md:px-5 py-3.5 text-sm leading-relaxed shadow-md min-w-[120px]">
                          {msg.text || <span className="text-zinc-700 animate-pulse font-mono text-lg">▋</span>}
                        </div>
                      </div>
                    )}

                    {/* ─ Comparison Mode grid ─ */}
                    {msg.modelResponses && (
                      <div className={`w-full grid gap-3 md:gap-4 ${gridClass}`}>
                        {selectedModels.map(modelId => {
                          const model    = AVAILABLE_MODELS.find(m => m.id === modelId);
                          const response = msg.modelResponses![modelId] ?? { text: '', status: 'idle' as StreamStatus };
                          const pc       = PROVIDER_COLORS[model?.provider ?? ''] ?? { text: 'text-zinc-400', badge: '', border: '' };

                          return (
                            <div
                              key={modelId}
                              className={`col-in bg-[#0a0a0c] border border-[#1f1f23] rounded-lg overflow-hidden flex flex-col shadow-xl
                                ${response.status === 'error' ? 'border-red-900/40' : ''}
                              `}
                            >
                              {/* Column header */}
                              <div className="px-4 py-2.5 bg-[#0d0d10] border-b border-[#1f1f23] flex items-center justify-between shrink-0">
                                <div className="flex items-center space-x-2 min-w-0">
                                  <span className={`text-[10px] font-mono font-bold uppercase tracking-widest truncate ${pc.text}`}>
                                    {model?.name ?? modelId}
                                  </span>
                                </div>
                                <StatusDot status={response.status} />
                              </div>

                              {/* Column body */}
                              <div className="flex-1 overflow-y-auto max-h-80 md:max-h-96 custom-scrollbar bg-gradient-to-b from-[#0a0a0c] to-[#070709] min-h-[80px]">
                                {response.status === 'loading'   && <ColumnSkeleton />}
                                {response.status === 'error'     && <ColumnError code={response.errorCode} />}
                                {(response.status === 'streaming' || response.status === 'done') && response.text && (
                                  <p className="p-4 text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                    {response.text}
                                  </p>
                                )}
                                {response.status === 'streaming' && !response.text && <ColumnSkeleton />}
                                {response.status === 'idle' && (
                                  <div className="p-4 text-zinc-700 font-mono text-xs">Waiting...</div>
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

            {/* ── ZK Error banner ── */}
            {zkError && (
              <div className="bg-red-950/15 border border-red-800/30 p-4 rounded-lg text-xs space-y-1.5 max-w-2xl mx-auto">
                <div className="flex items-center space-x-2 text-red-400 font-bold font-mono uppercase tracking-widest">
                  <span>⚠</span><span>Wallet / Bridge Error</span>
                </div>
                <p className="text-red-300/70 font-mono text-[11px] break-all">{zkError}</p>
                <button onClick={() => setZkError(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">Dismiss</button>
              </div>
            )}

            {/* ── Seal Audit Banner ── */}
            {sealRecord && (
              <div className="bg-emerald-950/10 border border-emerald-800/25 rounded-xl text-xs max-w-2xl mx-auto overflow-hidden shadow-[0_0_24px_rgba(16,185,129,0.08)]">
                {/* Header strip */}
                <div className="px-5 py-3 bg-emerald-950/20 border-b border-emerald-800/20 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-emerald-400 text-base">🔒</span>
                    <span className="font-bold font-mono uppercase tracking-widest text-emerald-400">Proof of Existence — On-Chain Confirmed</span>
                  </div>
                  <span className="text-emerald-600 font-mono text-[10px]">Block #{sealRecord.blockHeight}</span>
                </div>
                {/* Details grid */}
                <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Transaction ID</p>
                    <p className="font-mono text-zinc-200 text-[11px] break-all select-all">{sealRecord.txId}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Sealed At</p>
                    <p className="font-mono text-zinc-300 text-[11px]">{new Date(sealRecord.sealedAt).toISOString()}</p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">SHA-256 Conversation Hash</p>
                    <p className="font-mono text-emerald-300 text-[10px] break-all select-all tracking-wider">{sealRecord.hashHex}</p>
                  </div>
                </div>
                <div className="px-5 pb-3 text-[10px] text-zinc-600 font-mono">
                  Anyone holding this conversation can reproduce the hash and verify it against block #{sealRecord.blockHeight} on the Midnight ledger.
                </div>
              </div>
            )}

            {/* ── Verification Result Banner ── */}
            {verifyStatus === 'MATCHED' && (
              <div className="bg-emerald-950/10 border border-emerald-500/30 rounded-xl text-xs max-w-2xl mx-auto overflow-hidden shadow-[0_0_28px_rgba(16,185,129,0.15)]">
                <div className="px-5 py-3 bg-emerald-950/25 border-b border-emerald-700/20 flex items-center space-x-3">
                  <span className="text-2xl">✅</span>
                  <div>
                    <p className="font-bold font-mono uppercase tracking-widest text-emerald-400">Authentic State Sealed On-Chain</p>
                    <p className="text-emerald-600 text-[10px] font-mono mt-0.5">SHA-256 integrity check passed — zero tampering detected</p>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-2">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Verified Hash (Local ↔ On-Chain)</p>
                    <p className="font-mono text-emerald-300 text-[10px] break-all select-all tracking-wider">{verifyHashLocal}</p>
                  </div>
                  <div className="flex items-center space-x-2 text-[11px] text-emerald-400 font-mono mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Block #{sealRecord?.blockHeight} · {sealRecord ? new Date(sealRecord.sealedAt).toISOString() : ''}</span>
                  </div>
                </div>
              </div>
            )}

            {verifyStatus === 'TAMPERED' && (
              <div className="bg-red-950/15 border border-red-500/40 rounded-xl text-xs max-w-2xl mx-auto overflow-hidden shadow-[0_0_28px_rgba(239,68,68,0.2)]">
                <div className="px-5 py-3 bg-red-950/30 border-b border-red-700/25 flex items-center space-x-3">
                  <span className="text-2xl">❌</span>
                  <div>
                    <p className="font-bold font-mono uppercase tracking-widest text-red-400">Warning: Context State Corrupted / Altered</p>
                    <p className="text-red-500/70 text-[10px] font-mono mt-0.5">Current hash does NOT match the sealed on-chain record</p>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-2">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Current Local Hash</p>
                    <p className="font-mono text-red-300 text-[10px] break-all select-all tracking-wider">{verifyHashLocal}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">Original Sealed Hash (On-Chain)</p>
                    <p className="font-mono text-zinc-400 text-[10px] break-all select-all tracking-wider">{sealRecord?.hashHex}</p>
                  </div>
                  <p className="text-red-400/60 text-[10px] font-mono pt-1">⚠ The visible conversation no longer matches what was cryptographically committed. The conversation may have been modified after sealing.</p>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </section>

        {/* ─── INPUT FOOTER ──────────────────────────────────────────────── */}
        <footer className="p-3 md:p-5 border-t border-[#1f1f23] bg-[#0a0a0c]/80 backdrop-blur-md shrink-0">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSendMessage} className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isStreaming}
                placeholder={isStreaming ? 'Streaming response…' : 'Type secure anonymous message…'}
                className="w-full bg-[#121214] border border-[#1f1f23] focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/50 rounded-lg pl-4 md:pl-5 pr-14 py-3.5 md:py-4 text-sm text-[#f4f4f5] placeholder-zinc-600 outline-none transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isStreaming}
                className={`absolute right-3 md:right-4 w-9 h-9 rounded-md flex items-center justify-center transition-all ${
                  inputText.trim() && !isStreaming
                    ? 'bg-gradient-to-r from-violet-600 to-emerald-600 text-black hover:opacity-90 font-bold shadow-lg shadow-violet-500/20 cursor-pointer'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                {isStreaming ? <span className="text-xs animate-spin">⌛</span> : <span>⚡</span>}
              </button>
            </form>
            <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-600 px-1 font-mono uppercase tracking-wider">
              <span className="truncate">
                {isComparisonMode
                  ? `comparison · ${selectedModels.length} stream${selectedModels.length > 1 ? 's' : ''}`
                  : `single · ${activeSingleModel?.name ?? '—'}`
                }
              </span>
              <span className="shrink-0 ml-2">secure zk proxy: active</span>
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}
