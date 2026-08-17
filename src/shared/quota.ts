export interface ClaudeRateLimitWindow {
  usedPct: number;
  resetsAt: string | null;
}

export interface ClaudeQuotaSnapshot {
  fiveHour: ClaudeRateLimitWindow | null;
  sevenDay: ClaudeRateLimitWindow | null;
}

export interface CodexRateLimitWindow {
  usedPct: number;
  windowMins: number | null;
  resetsAt: number | null;
}

export interface CodexQuotaSnapshot {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}

export interface QuotaState {
  claude: ClaudeQuotaSnapshot | null;
  codex: CodexQuotaSnapshot | null;
}

/** Provider quota exhaustion block — set when a CLI reports the account's
 *  usage allocation has been exhausted (not a transient rate-limit). */
export interface QuotaBlockInfo {
  /** Which provider hit the limit ('codex', 'claude', etc.) */
  provider: string;
  /** Epoch ms when the block was detected. */
  blockedAt: number;
  /** Epoch ms when the provider's window resets, or null if unknown. */
  resetsAt: number | null;
}
