import type { ClaudeQuotaSnapshot, CodexQuotaSnapshot } from '@shared/quota';

export function remaining(usedPct: number): string {
  return `${Math.max(0, 100 - Math.round(usedPct))}%`;
}

export function windowLabel(mins: number | null): string {
  if (!mins) return '?h';
  const h = mins / 60;
  return h < 24 ? `${Math.round(h)}h` : 'Week';
}

export function timeUntil(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return '';
  const totalMins = Math.round(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

export function claudeText(snap: ClaudeQuotaSnapshot): string {
  const parts: string[] = [];
  if (snap.fiveHour) {
    const pct = remaining(snap.fiveHour.usedPct);
    const until = timeUntil(snap.fiveHour.resetsAt);
    parts.push(until ? `5h ${pct} ↻${until}` : `5h ${pct}`);
  }
  if (snap.sevenDay) parts.push(`W ${remaining(snap.sevenDay.usedPct)}`);
  return parts.length ? parts.join(' · ') : '--';
}

export function codexText(snap: CodexQuotaSnapshot): string {
  const parts: string[] = [];
  if (snap.primary) parts.push(`${windowLabel(snap.primary.windowMins)} ${remaining(snap.primary.usedPct)}`);
  if (snap.secondary) parts.push(`${windowLabel(snap.secondary.windowMins)} ${remaining(snap.secondary.usedPct)}`);
  return parts.length ? parts.join(' ') : '--';
}
