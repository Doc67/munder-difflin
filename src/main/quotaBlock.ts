/**
 * Provider quota exhaustion detection and per-agent block state.
 *
 * parseQuotaExhaustion() scans raw PTY output for quota-limit messages and
 * returns a QuotaBlockInfo when found.  QuotaBlockRegistry holds the active
 * blocks; index.ts registers a PTY output monitor that feeds it.
 *
 * The type is also exported from src/shared/quota.ts so the preload and
 * renderer can reference it without importing from main.
 */

export type { QuotaBlockInfo } from '../shared/quota';
import type { QuotaBlockInfo } from '../shared/quota';

// ANSI escape sequence stripper (VT100 / xterm sequences).
const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-2AB]|[=><FGH78M])/g;

// "try again at Aug 20th, 2026 12:24 PM" or "try again at August 20, 2026"
const RESET_RE = /try\s+again\s+(?:at\s+)?([A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?[, ]+\d{4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*[AP]M)?)/i;

function parseResetsAt(text: string): number | null {
  const m = RESET_RE.exec(text);
  if (!m) return null;
  const clean = m[1].replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1').trim();
  const ms = Date.parse(clean);
  return isNaN(ms) ? null : ms;
}

// Patterns that definitively indicate account-level quota exhaustion (not
// transient rate-limit backoff).  Deliberately conservative: only match when
// the message clearly says the usage allocation/window is exhausted.
const QUOTA_PATTERNS: RegExp[] = [
  /you.{0,40}hit your usage limit/i,
  /usage\s+limit\s+(?:has\s+been\s+)?(?:reached|exceeded)/i,
  /account\s+(?:usage\s+)?(?:quota|limit)\s+(?:has\s+been\s+)?(?:reached|exceeded)/i,
  /subscription\s+(?:usage\s+)?limit\s+(?:has\s+been\s+)?(?:reached|exceeded)/i,
];

/**
 * Scan a raw PTY chunk (after stripping ANSI escapes) for quota exhaustion
 * messages.  Returns a QuotaBlockInfo when a match is found, null otherwise.
 * The caller should pass a rolling buffer of recent output so messages that
 * span multiple small chunks are still matched.
 */
export function parseQuotaExhaustion(raw: string, provider: string): QuotaBlockInfo | null {
  const text = raw.replace(ANSI_RE, '');
  if (!QUOTA_PATTERNS.some((re) => re.test(text))) return null;
  return {
    provider,
    blockedAt: Date.now(),
    resetsAt: parseResetsAt(text)
  };
}

/** Per-agent quota block state, owned by the main process. */
export class QuotaBlockRegistry {
  private readonly blocks = new Map<string, QuotaBlockInfo>();

  set(agentId: string, info: QuotaBlockInfo): void {
    this.blocks.set(agentId, info);
  }

  clear(agentId: string): void {
    this.blocks.delete(agentId);
  }

  get(agentId: string): QuotaBlockInfo | null {
    return this.blocks.get(agentId) ?? null;
  }

  blockedIds(): Set<string> {
    return new Set(this.blocks.keys());
  }
}
