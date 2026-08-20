import { useEffect, useState } from 'react';
import type { QuotaState } from '@shared/quota';
import { claudeText, codexText } from './quotaFormat';

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
