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
