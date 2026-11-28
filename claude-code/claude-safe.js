#!/usr/bin/env node
/**
 * Geo-Guarded Claude Code CLI Wrapper (claude-safe)
 * Verifies proxy + non-RU/BY egress IP before spawning claude.exe.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { verifyEgress } = require('./geo-guard');

function findClaudeCodeExe() {
  const localBin = path.join(process.env.USERPROFILE, '.local', 'bin', 'claude.exe');
  if (fs.existsSync(localBin)) return localBin;

  const appDataBase = path.join(process.env.APPDATA, 'Claude', 'claude-code');
  if (fs.existsSync(appDataBase)) {
    const versions = fs.readdirSync(appDataBase).sort().reverse();
    for (const v of versions) {
      const vDir = path.join(appDataBase, v);
      if (!fs.statSync(vDir).isDirectory()) continue;
      for (const sub of fs.readdirSync(vDir)) {
        const candidate = path.join(vDir, sub, 'claude.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  try {
    const out = execFileSync('where.exe', ['claude.exe'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out.split(/\r?\n/)[0].trim();
  } catch {}

  return null;
}

function getConfiguredProxy() {
  try {
    const settingsPath = path.join(process.env.USERPROFILE, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (s.env && (s.env.HTTPS_PROXY || s.env.HTTP_PROXY)) {
        return s.env.HTTPS_PROXY || s.env.HTTP_PROXY;
      }
    }
  } catch {}
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:10809';
}

async function main() {
  const proxy = getConfiguredProxy();
  const check = await verifyEgress(proxy);
  if (!check.ok) {
    console.error(`\x1b[31m[claude-safe] BLOCKED:\x1b[0m ${check.message}`);
    process.exit(2);
  }

  const exe = findClaudeCodeExe();
  if (!exe) {
    console.error('[claude-safe] claude.exe not found.');
    process.exit(1);
  }

  console.log(`\x1b[32m[claude-safe]\x1b[0m Egress verified: ${check.ip} (${check.country}) via ${proxy}`);

  const res = spawnSync(exe, process.argv.slice(2), {
    stdio: 'inherit',
    env: {
      ...process.env,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      NO_PROXY: 'localhost,127.0.0.1,::1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_BUG_COMMAND: '1',
      TZ: 'Europe/Berlin'
    }
  });
  process.exit(res.status ?? 0);
}

main();
