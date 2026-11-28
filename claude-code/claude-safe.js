#!/usr/bin/env node
/**
 * Cross-Platform Geo-Guarded Claude Code CLI Wrapper (claude-safe)
 * Verifies proxy + non-RU/BY egress IP and resolves the latest claude binary
 * across Windows, macOS, and Linux before launching.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { verifyEgress } = require('./geo-guard');
const { findClaudeCodeExe } = require('./platform');

function getConfiguredSettings() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return s.env || {};
    }
  } catch {}
  return {};
}

async function main() {
  const cfgEnv = getConfiguredSettings();
  const proxy = cfgEnv.HTTPS_PROXY || cfgEnv.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:10809';
  const tz = cfgEnv.TZ || 'Europe/Berlin';

  const check = await verifyEgress(proxy);
  if (!check.ok) {
    console.error(`\x1b[31m[claude-safe] BLOCKED:\x1b[0m ${check.message}`);
    process.exit(2);
  }

  const exe = findClaudeCodeExe();
  if (!exe) {
    console.error('[claude-safe] Claude Code binary not found.');
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
      TZ: tz
    }
  });
  process.exit(res.status ?? 0);
}

main();
