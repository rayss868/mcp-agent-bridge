import path from 'node:path';
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { seaAwareDirname } from './sea-paths.js';

const __dirname = seaAwareDirname(import.meta.url);
const projectRoot = __dirname;
const SETTINGS_PATH = path.join(projectRoot, 'config', 'tunnel.json');

const DEFAULT_SETTINGS = {
  provider: 'cloudflared-quick',
  ngrokDomain: '',
  ngrokToken: '',
  cloudflaredToken: '',
  publicUrl: '',
  autoStart: false
};

const PROVIDERS = new Set(['cloudflared-quick', 'cloudflared-named', 'ngrok']);

const MAX_LOG_LINES = 60;

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function resolveNgrokCommand() {
  if (process.env.NGROK_PATH) {
    return process.env.NGROK_PATH;
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(userProfile, 'bin', 'ngrok.exe');
}

export class TunnelManager {
  constructor({ host, port }) {
    this.host = host;
    this.port = port;
    this.child = null;
    this.url = null;
    this.lastError = null;
    this.logLines = [];
    this.settings = { ...DEFAULT_SETTINGS };

    process.once('exit', () => {
      if (this.child && this.child.exitCode === null) {
        this.child.kill();
      }
    });
  }

  async ensureDir() {
    try { await mkdir(path.dirname(SETTINGS_PATH), { recursive: true }); } catch {}
  }

  async loadSettings() {
    try {
      const raw = await readFile(SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  async saveSettings(patch) {
    await this.ensureDir();
    const next = { ...this.settings, ...patch };
    if (!PROVIDERS.has(next.provider)) {
      throw new Error(`Unknown tunnel provider: ${next.provider}`);
    }
    this.settings = next;
    await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  status() {
    return {
      running: this.isRunning(),
      url: this.isRunning() ? this.url : null,
      connectorUrl: this.isRunning() && this.url ? `${this.url.replace(/\/$/, '')}/mcp` : null,
      provider: this.settings.provider,
      error: this.lastError,
      log: this.logLines.join('\n'),
      settings: { ...this.settings }
    };
  }

  buildCommand(settings) {
    const cloudflared = path.join(projectRoot, 'tools', 'cloudflared.exe');

    if (settings.provider === 'cloudflared-quick') {
      return {
        command: cloudflared,
        args: ['tunnel', '--protocol', 'http2', '--url', `http://${this.host}:${this.port}`],
        expectedUrl: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
      };
    }

    if (settings.provider === 'cloudflared-named') {
      if (!settings.cloudflaredToken) {
        throw new Error('Cloudflared token kosong — isi token tunnel di pengaturan');
      }
      if (!settings.publicUrl) {
        throw new Error('Public URL kosong — isi URL tunnel (mis. https://tunnel.example.com)');
      }
      return {
        command: cloudflared,
        args: ['tunnel', '--protocol', 'http2', '--token', settings.cloudflaredToken],
        fixedUrl: settings.publicUrl.replace(/\/$/, '')
      };
    }

    if (settings.provider === 'ngrok') {
      if (!settings.ngrokDomain) {
        throw new Error('Domain ngrok kosong — isi reserved domain (mis. abc.ngrok-free.app)');
      }
      if (!settings.ngrokToken) {
        throw new Error('ngrok Authtoken kosong — isi token di pengaturan');
      }
      return {
        command: resolveNgrokCommand(),
        args: ['http', `--domain=${settings.ngrokDomain}`, String(this.port)],
        env: { ...process.env, NGROK_AUTHTOKEN: settings.ngrokToken },
        fixedUrl: `https://${settings.ngrokDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
      };
    }

    throw new Error(`Unknown tunnel provider: ${settings.provider}`);
  }

  async start(patch) {
    if (this.isRunning()) {
      throw new Error('Tunnel sudah berjalan — stop dulu sebelum ganti pengaturan');
    }

    const settings = await this.saveSettings(patch || {});
    const { command, args, expectedUrl, fixedUrl, env } = this.buildCommand(settings);

    this.url = fixedUrl || null;
    this.lastError = null;
    this.logLines = [];

    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env || process.env,
      windowsHide: true
    });
    this.child = child;

    let output = '';
    const handleChunk = (chunk) => {
      const text = stripAnsi(String(chunk));
      this.logLines.push(...text.split(/\r?\n/).filter(Boolean));
      if (this.logLines.length > MAX_LOG_LINES) {
        this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES);
      }
      output += text;
      if (!this.url && expectedUrl) {
        const match = output.match(expectedUrl);
        if (match) {
          this.url = match[0];
        }
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('error', (error) => {
      this.lastError = `Gagal menjalankan ${command}: ${error.message}`;
      this.child = null;
      this.url = null;
    });

    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
        if (code !== 0 && code !== null) {
          this.lastError = `Tunnel berhenti (code ${code ?? signal}): ${this.logLines.slice(-5).join(' | ')}`;
        }
        this.url = null;
      }
    });

    const state = await this.waitForUrl(15000);
    return state;
  }

  async waitForUrl(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isRunning()) {
        throw new Error(this.lastError || 'Tunnel berhenti sebelum siap');
      }
      if (this.url) {
        return this.status();
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (this.url) {
      return this.status();
    }
    throw new Error(`Tunnel tidak memberi URL dalam ${Math.round(timeoutMs / 1000)}s: ${this.logLines.slice(-5).join(' | ') || 'tidak ada output'}`);
  }

  stop() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
      this.child = null;
    }
    this.url = null;
    return this.status();
  }
}
