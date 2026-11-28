/**
 * Cross-Platform Claude Code CLI Privacy, Proxy & Anti-Telemetry Hardener
 * Works on Windows, macOS, and Linux.
 * - Merges hardened env vars into ~/.claude/settings.json (update-proof)
 * - Applies OS Enterprise Policies (Windows HKCU / macOS defaults)
 * - Installs geo-guarded `claude-safe` wrapper into ~/.local/bin/
 */
const fs = require('fs');
const path = require('path');
const { PLATFORM, HOME, applyEnterprisePolicies } = require('../shared/platform');

const REPO_ROOT = path.resolve(__dirname, '..');

async function patchCode(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  const timezone = opts.tz || 'Europe/Berlin';

  const claudeDir = path.join(HOME, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const binDir = path.join(HOME, '.local', 'bin');

  console.log(`=== CLAUDE CODE CLI PRIVACY & TELEMETRY HARDENER (${PLATFORM}) ===`);
  console.log(`Proxy: ${proxyUrl} | Timezone: ${timezone}`);

  // 1. Merge hardened env into ~/.claude/settings.json
  console.log('[1/3] Hardening ~/.claude/settings.json...');
  fs.mkdirSync(claudeDir, { recursive: true });
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
      settings = {};
    }
  }

  settings.env = {
    ...(settings.env || {}),
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_BUG_COMMAND: '1',
    TZ: timezone
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`      Updated ${settingsPath}`);

  // 2. Apply OS Enterprise Policies
  console.log('[2/3] Applying OS Enterprise Policies...');
  applyEnterprisePolicies('code');

  // 3. Install cross-platform claude-safe wrapper into ~/.local/bin
  console.log('[3/3] Installing claude-safe geo-guarded wrapper...');
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'geo-guard.js'), path.join(binDir, 'geo-guard.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'platform.js'), path.join(binDir, 'platform.js'));
  fs.copyFileSync(path.join(__dirname, 'claude-safe.js'), path.join(binDir, 'claude-safe.js'));

  if (PLATFORM === 'win32') {
    fs.writeFileSync(path.join(binDir, 'claude-safe.cmd'), '@echo off\r\nnode "%~dp0claude-safe.js" %*\r\n', 'utf8');
    console.log(`      Installed ${path.join(binDir, 'claude-safe.cmd')}`);
  } else {
    const shWrapper = path.join(binDir, 'claude-safe');
    fs.writeFileSync(shWrapper, '#!/usr/bin/env bash\nexec node "$(dirname "$0")/claude-safe.js" "$@"\n', { mode: 0o755 });
    console.log(`      Installed ${shWrapper} (ensure ~/.local/bin is in PATH)`);
  }

  console.log('=== CLAUDE CODE CLI HARDENING COMPLETE ===\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name, fb) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fb;
  };
  patchCode({
    proxy: getArg('--proxy', undefined),
    tz: getArg('--tz', undefined)
  }).catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { patchCode };
