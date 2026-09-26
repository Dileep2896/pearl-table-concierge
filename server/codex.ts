import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Locked-down Codex CLI invocation: read-only sandbox, no tools, strict JSON schema output. */
export function codexArguments(directory: string, schemaPath: string, outputPath: string): string[] {
  return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-C', directory,
    '--output-schema', schemaPath, '--output-last-message', outputPath,
    '-c', 'approval_policy="never"', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
    ...['shell_tool', 'unified_exec', 'code_mode_host', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'image_generation', 'memories', 'shell_snapshot', 'skill_search', 'skill_mcp_dependency_install', 'view_image', 'unbounded_connection_retries'].flatMap(name => ['-c', `features.${name}=false`]), '-'];
}
export function codexEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'CODEX_HOME', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'SSL_CERT_FILE', 'SSL_CERT_DIR'].flatMap(key => env[key] ? [[key, env[key]!]] : []));
}
export class CodexUnavailable extends Error { constructor(message = 'Codex CLI did not return a reply.') { super(message); this.name = 'CodexUnavailable'; } }

export async function runCodex(prompt: string, jsonSchema: unknown, options: { timeoutMs?: number; bin?: string } = {}): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'pearl-demo-'));
  try {
    const schemaPath = join(directory, 'schema.json'); const outputPath = join(directory, 'reply.json');
    await writeFile(schemaPath, JSON.stringify(jsonSchema), { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.bin || process.env.PEARL_CODEX_BIN || 'codex', codexArguments(directory, schemaPath, outputPath), { cwd: directory, env: codexEnvironment(process.env), shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let stopped = false; let bytes = 0;
      const stop = () => { stopped = true; child.kill('SIGKILL'); };
      const timer = setTimeout(stop, options.timeoutMs ?? 60_000);
      const drain = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_000_000) stop(); };
      child.stdout.on('data', drain); child.stderr.on('data', drain);
      child.on('error', () => { clearTimeout(timer); reject(new CodexUnavailable('Codex CLI is not installed or not on PATH.')); });
      child.on('close', code => { clearTimeout(timer); if (code === 0 && !stopped) resolve(); else reject(new CodexUnavailable(stopped ? 'Codex timed out.' : `Codex exited with code ${code}.`)); });
      child.stdin.on('error', () => {}); child.stdin.end(prompt);
    });
    const output = await readFile(outputPath, 'utf8');
    if (Buffer.byteLength(output) > 16_000) throw new CodexUnavailable('Codex reply was too large.');
    return JSON.parse(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

import { createHash } from 'node:crypto';
import { log } from './logger';

export type CodexRunner = (prompt: string, jsonSchema: unknown) => Promise<unknown>;

/**
 * Serialises Codex calls and remembers recent answers. The CLI spawns a whole process per call, so
 * running several at once only makes each slower; identical prompts (a retried request, a double
 * click) are answered from memory.
 */
export class CodexQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();
  private pending = 0;
  constructor(private options: { run?: CodexRunner; timeoutMs?: number; cacheMs?: number; maxQueued?: number; now?: () => number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  // Arrow field so a detached reference (e.g. passed as a callback) keeps `this` bound to the queue.
  status = () => ({ pending: this.pending, cached: this.cache.size });

  run: CodexRunner = (prompt, schema) => {
    const key = createHash('sha256').update(prompt).update(JSON.stringify(schema)).digest('hex');
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (this.options.cacheMs ?? 300_000)) return hit.value;
    if (this.pending >= (this.options.maxQueued ?? 4)) return Promise.reject(new CodexUnavailable('Codex is busy with other replies.'));
    this.pending += 1;
    const started = performance.now();
    const value = this.tail.then(() => (this.options.run ?? ((p, s) => runCodex(p, s, { timeoutMs: this.options.timeoutMs })))(prompt, schema))
      .finally(() => { this.pending -= 1; log('info', 'codex_turn', { ms: Math.round(performance.now() - started), queued: this.pending }); });
    this.tail = value.catch(() => undefined);
    this.cache.set(key, { at: this.now(), value });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 200) for (const [k, v] of this.cache) if (this.now() - v.at > (this.options.cacheMs ?? 300_000)) this.cache.delete(k);
    return value;
  };
}
