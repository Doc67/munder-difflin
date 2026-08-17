/**
 * CodexRateLimitService — drives `codex app-server` as a child process and
 * communicates over its stdio JSON-RPC transport.
 *
 * On Windows we invoke `node.exe <codex.js>` directly (not the `.cmd` shim)
 * so that Node's spawn can exec the file without shell:true.
 *
 * Independent of individual Codex worker PTYs.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveCommand } from './shellEnv';
import type { CodexQuotaSnapshot, CodexRateLimitWindow } from '../shared/quota';

const TAG = '[quota:codex]';

// ─── Protocol types ───────────────────────────────────────────────────────────

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

interface RateLimitSnapshot {
  limitId?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: string | null;
  rateLimitReachedType?: string | null;
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
  spendControlReached?: boolean | null;
}

interface RateLimitsResult {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
}

// ─── Bucket identification ────────────────────────────────────────────────────

function parseWindow(w: RateLimitWindow | null | undefined): CodexRateLimitWindow | null {
  if (!w) return null;
  return {
    usedPct: w.usedPercent,
    windowMins: w.windowDurationMins ?? null,
    resetsAt: w.resetsAt ?? null
  };
}

/** Prefer rateLimitsByLimitId['codex'] when present, fall back to rateLimits. */
function pickSnapshot(result: RateLimitsResult): RateLimitSnapshot {
  const byId = result.rateLimitsByLimitId;
  if (byId && typeof byId === 'object' && byId['codex']) return byId['codex'];
  return result.rateLimits;
}

/**
 * Build a CodexQuotaSnapshot from the chosen RateLimitSnapshot.
 * Buckets identified by windowDurationMins: 300→5h, ≥9000→weekly.
 * Falls back to positional order when windowDurationMins is absent.
 */
function parseRateLimitSnapshot(snap: RateLimitSnapshot): CodexQuotaSnapshot {
  const windows: RateLimitWindow[] = [snap.primary, snap.secondary]
    .filter((w): w is RateLimitWindow => !!w);

  let fiveHour: CodexRateLimitWindow | null = null;
  let weekly: CodexRateLimitWindow | null = null;
  const unclassified: CodexRateLimitWindow[] = [];

  for (const w of windows) {
    const mins = w.windowDurationMins ?? null;
    if (mins === 300) {
      fiveHour = parseWindow(w);
    } else if (mins !== null && mins >= 9000) {
      weekly = parseWindow(w);
    } else {
      unclassified.push(parseWindow(w)!);
    }
  }

  // Positional fallback when windowDurationMins is absent
  if (!fiveHour && !weekly) {
    [fiveHour, weekly] = [unclassified[0] ?? null, unclassified[1] ?? null];
  } else if (fiveHour && !weekly) {
    weekly = unclassified[0] ?? null;
  } else if (!fiveHour && weekly) {
    fiveHour = unclassified[0] ?? null;
  }

  return { primary: fiveHour, secondary: weekly };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CodexRateLimitService {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, (result: unknown) => void>();
  private stopped = false;
  private lineBuf = '';

  constructor(private readonly onUpdate: (snap: CodexQuotaSnapshot) => void) {}

  start(): void {
    this.stopped = false;
    void this.run();
  }

  private async run(): Promise<void> {
    // Spawn codex app-server in stdio mode.
    // On Windows, use node.exe + codex.js directly to avoid the .cmd shim issue.
    let spawnCmd: string;
    let spawnArgs: string[];

    if (process.platform === 'win32') {
      let nodeExe = 'node';
      let codexResolved = '';
      try { codexResolved = resolveCommand('codex'); } catch { /* noop */ }
      try { nodeExe = resolveCommand('node'); } catch { /* noop */ }

      const npmBinDir = codexResolved ? dirname(codexResolved) : '';
      const codexJs = npmBinDir
        ? join(npmBinDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
        : '';

      console.log(TAG, 'nodeExe:', nodeExe, 'codexJs:', codexJs,
        'exists:', codexJs ? existsSync(codexJs) : 'n/a');

      if (codexJs && existsSync(codexJs)) {
        spawnCmd = nodeExe;
        spawnArgs = [codexJs, 'app-server'];
      } else {
        console.error(TAG, 'codex.js not found — quota service disabled');
        return;
      }
    } else {
      let codexExe = 'codex';
      try { codexExe = resolveCommand('codex'); } catch { /* noop */ }
      spawnCmd = codexExe;
      spawnArgs = ['app-server'];
    }

    console.log(TAG, 'spawning:', spawnCmd, spawnArgs.join(' '));

    let proc: ChildProcess;
    try {
      proc = nodeSpawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
      console.log(TAG, 'pid:', proc.pid);
    } catch (err) {
      console.error(TAG, 'spawn failed:', err);
      return;
    }

    this.proc = proc;

    proc.stderr?.on('data', (d: Buffer) => {
      // codex writes startup banners to stderr — log for debugging
      const text = d.toString().replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (text) console.log(TAG, 'stderr:', text.slice(0, 200));
    });
    proc.on('error', (err) => console.error(TAG, 'proc error:', err));
    proc.on('exit', (code, sig) => {
      console.log(TAG, 'exited code:', code, 'signal:', sig);
      this.proc = null;
    });

    // Wire up newline-delimited JSON from stdout
    proc.stdout?.on('data', (d: Buffer) => {
      this.lineBuf += d.toString();
      let idx: number;
      while ((idx = this.lineBuf.indexOf('\n')) >= 0) {
        const line = this.lineBuf.slice(0, idx).trim();
        this.lineBuf = this.lineBuf.slice(idx + 1);
        if (line) this.handleLine(line);
      }
    });

    if (this.stopped) return;

    // Give the server a moment to initialize its own state before sending
    await new Promise(r => setTimeout(r, 1500));
    if (this.stopped) return;

    try { await this.runProtocol(); } catch (err) {
      console.error(TAG, 'protocol error:', err);
    }
  }

  private async runProtocol(): Promise<void> {
    // Step 1 — initialize
    console.log(TAG, 'sending initialize');
    const initResult = await this.rpc('initialize', {
      clientInfo: { name: 'munder-difflin', version: '1.0.0' }
    });
    console.log(TAG, 'initialize result:', JSON.stringify(initResult)?.slice(0, 200));
    if (this.stopped) return;

    // Step 2 — initialized notification (required by the protocol)
    this.notify('initialized', {});

    // Step 3 — account/rateLimits/read
    console.log(TAG, 'sending account/rateLimits/read');
    const rlResult = await this.rpc('account/rateLimits/read', null);
    console.log(TAG, 'rateLimits RAW:', JSON.stringify(rlResult)?.slice(0, 500));
    if (this.stopped || !rlResult || typeof rlResult !== 'object') {
      console.warn(TAG, 'rate limits result null or non-object');
      return;
    }

    const r = rlResult as Partial<RateLimitsResult>;
    if (!r.rateLimits) {
      console.warn(TAG, 'rateLimits field missing');
      return;
    }

    const chosen = pickSnapshot(r as RateLimitsResult);
    const snap = parseRateLimitSnapshot(chosen);
    console.log(TAG, 'snapshot:', JSON.stringify(snap));
    this.onUpdate(snap);
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      if (!this.proc?.stdin) { resolve(null); return; }
      const id = this.nextId++;
      this.pending.set(id, resolve);
      const msg = params !== null && params !== undefined
        ? JSON.stringify({ jsonrpc: '2.0', id, method, params })
        : JSON.stringify({ jsonrpc: '2.0', id, method });
      this.proc.stdin.write(msg + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          console.warn(TAG, 'rpc timeout:', method);
          this.pending.delete(id);
          resolve(null);
        }
      }, 15_000);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private handleLine(line: string): void {
    let msg: { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown };
    try { msg = JSON.parse(line); } catch {
      console.warn(TAG, 'malformed line:', line.slice(0, 100));
      return;
    }

    if (msg.error) console.warn(TAG, 'server error id:', msg.id, JSON.stringify(msg.error));

    if (typeof msg.id === 'number') {
      const cb = this.pending.get(msg.id);
      if (cb) { this.pending.delete(msg.id); cb(msg.result ?? null); }
      return;
    }

    // Push notification: rate limits updated
    if (msg.method === 'account/rateLimits/updated' && msg.params) {
      console.log(TAG, 'push rateLimits/updated');
      const p = msg.params as { rateLimits?: RateLimitSnapshot };
      if (p.rateLimits) this.onUpdate(parseRateLimitSnapshot(p.rateLimits));
    }
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();
    try { this.proc?.stdin?.end(); } catch { /* noop */ }
    try { this.proc?.kill(); } catch { /* noop */ }
    this.proc = null;
  }
}
