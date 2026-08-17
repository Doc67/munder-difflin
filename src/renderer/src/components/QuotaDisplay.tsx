import { useEffect, useState } from 'react';
import type { ClaudeQuotaSnapshot, CodexQuotaSnapshot, QuotaState } from '@shared/quota';

function remaining(usedPct: number): string {
  return `${Math.max(0, 100 - Math.round(usedPct))}%`;
}

function windowLabel(mins: number | null): string {
  if (!mins) return '?h';
  const h = mins / 60;
  return h < 24 ? `${Math.round(h)}h` : 'W';
}

function timeUntil(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return '';
  const totalMins = Math.round(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function claudeText(snap: ClaudeQuotaSnapshot): string {
  const parts: string[] = [];
  if (snap.fiveHour) {
    const pct = remaining(snap.fiveHour.usedPct);
    const until = timeUntil(snap.fiveHour.resetsAt);
    parts.push(until ? `5h ${pct} ↻${until}` : `5h ${pct}`);
  }
  if (snap.sevenDay) parts.push(`W ${remaining(snap.sevenDay.usedPct)}`);
  return parts.length ? parts.join(' · ') : '--';
}

function codexText(snap: CodexQuotaSnapshot): string {
  const parts: string[] = [];
  if (snap.primary) parts.push(`${windowLabel(snap.primary.windowMins)} ${remaining(snap.primary.usedPct)}`);
  if (snap.secondary) parts.push(`${windowLabel(snap.secondary.windowMins)} ${remaining(snap.secondary.usedPct)}`);
  return parts.length ? parts.join(' · ') : '--';
}

function tooltipFor(snap: QuotaState): string {
  const lines: string[] = [];
  if (snap.claude?.fiveHour?.resetsAt) lines.push(`Claude 5h resets: ${snap.claude.fiveHour.resetsAt}`);
  if (snap.claude?.sevenDay?.resetsAt) lines.push(`Claude week resets: ${snap.claude.sevenDay.resetsAt}`);
  if (snap.codex?.primary?.resetsAt) lines.push(`Codex primary resets: ${new Date(snap.codex.primary.resetsAt * 1000).toLocaleString()}`);
  if (snap.codex?.secondary?.resetsAt) lines.push(`Codex secondary resets: ${new Date(snap.codex.secondary.resetsAt * 1000).toLocaleString()}`);
  return lines.join('\n') || 'Claude + Codex subscription rate limits';
}

export function QuotaDisplay({ className }: { className?: string }): JSX.Element | null {
  const [quota, setQuota] = useState<QuotaState | null>(null);

  useEffect(() => {
    void window.cth.quotaGet().then(setQuota);
    return window.cth.onQuotaUpdated(setQuota);
  }, []);

  // Render nothing until we have data so we don't show "--  |  --" on cold start
  if (!quota?.claude && !quota?.codex) return null;

  const claudeStr = quota.claude ? claudeText(quota.claude) : '--';
  const codexStr = quota.codex ? codexText(quota.codex) : '--';

  const labelStyle: React.CSSProperties = {
    color: 'var(--cth-ink-700)',
    fontWeight: 600,
    letterSpacing: '0.05em'
  };

  return (
    <span
      className={className}
      title={tooltipFor(quota)}
      style={{
        fontFamily: 'var(--cth-font-ui)',
        fontSize: 11,
        color: 'var(--cth-ink-500)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        whiteSpace: 'nowrap'
      }}
    >
      <span style={labelStyle}>CLAUDE</span>
      <span>{claudeStr}</span>
      <span style={{ opacity: 0.35, margin: '0 2px' }}>|</span>
      <span style={labelStyle}>CODEX</span>
      <span>{codexStr}</span>
    </span>
  );
}
