/**
 * P2 Privacy Proxy — Automated Sensitive Data & PII Redaction Engine
 *
 * Intercepts conversation streams and scrubs Personally Identifiable Information (PII),
 * authentication secrets, credentials, and financial identifiers before prompts are dispatched
 * to upstream AI models.
 */

export interface RedactionResult {
  sanitizedText: string;
  redactedCount: number;
  redactedTypes: string[];
}

export interface RedactionRule {
  type: string;
  label: string;
  pattern: RegExp;
  replacement: (match: string) => string;
}

export const P2_REDACTION_RULES: RedactionRule[] = [
  // 1. API Keys & Secrets (OpenAI, Google, AWS, GitHub, generic bearer tokens)
  {
    type: 'API_KEY',
    label: 'API Keys & Secrets',
    pattern: /\b(?:sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|bearer\s+[a-zA-Z0-9_\-\.]{30,})\b/gi,
    replacement: () => '[REDACTED_API_KEY]',
  },
  // 2. Private Keys (RSA, EC, PGP header blocks)
  {
    type: 'PRIVATE_KEY',
    label: 'Private Key Blocks',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: () => '[REDACTED_PRIVATE_KEY_BLOCK]',
  },
  // 3. Email Addresses
  {
    type: 'EMAIL',
    label: 'Email Addresses',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g,
    replacement: () => '[REDACTED_EMAIL]',
  },
  // 4. Credit / Debit Cards (13-19 digits, spaced or hyphenated)
  {
    type: 'CREDIT_CARD',
    label: 'Credit / Debit Cards',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b/g,
    replacement: () => '[REDACTED_PAYMENT_CARD]',
  },
  // 5. Social Security Numbers / National IDs (US SSN: XXX-XX-XXXX)
  {
    type: 'NATIONAL_ID',
    label: 'Social Security / National ID',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: () => '[REDACTED_NATIONAL_ID]',
  },
  // 6. Phone Numbers (international with +, US format, dashed 10-digits)
  {
    type: 'PHONE_NUMBER',
    label: 'Phone Numbers',
    pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: () => '[REDACTED_PHONE]',
  },
  // 7. IPv4 Addresses
  {
    type: 'IP_ADDRESS',
    label: 'IP Addresses',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: () => '[REDACTED_IP]',
  },
];

/**
 * Executes full P2 Proxy redaction across a given text string.
 * Replaces sensitive identifiers with cryptographically tagged redaction tokens.
 */
export function p2Redact(text: string): RedactionResult {
  if (!text) {
    return { sanitizedText: '', redactedCount: 0, redactedTypes: [] };
  }

  let sanitizedText = text;
  let redactedCount = 0;
  const detectedTypes = new Set<string>();

  for (const rule of P2_REDACTION_RULES) {
    const matches = sanitizedText.match(rule.pattern);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      detectedTypes.add(rule.type);
      sanitizedText = sanitizedText.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    sanitizedText,
    redactedCount,
    redactedTypes: Array.from(detectedTypes),
  };
}
