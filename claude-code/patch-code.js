/**
 * Claude Code CLI Privacy, Proxy & Anti-Telemetry Hardener
 * - Merges hardened env vars into ~/.claude/settings.json
 * - Sets HKCU\SOFTWARE\Policies\ClaudeCode flags
 * - Installs geo-guarded `claude-safe.cmd` into ~/.local/bin/
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function patchCode(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  const timezone = opts.tz || 'Europe/Berlin';

  const home = process.env.USERPROFILE;
  const claudeDir = path.join(home, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const binDir = path.join(home, '.local', 'bin');

  console.log('=== CLAUDE CODE CLI PRIVACY & TELEMETRY HARDENER ===');
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

  // 2. Apply Group Policy flags under HKCU\SOFTWARE\Policies\ClaudeCode
  console.log('[2/3] Applying Group Policy flags (HKCU\\SOFTWARE\\Policies\\ClaudeCode)...');
  for (const key of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
    execSync(`reg add HKCU\\SOFTWARE\\Policies\\ClaudeCode /v ${key} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
  }

  // 3. Install claude-safe wrapper into ~/.local/bin
  console.log('[3/3] Installing claude-safe geo-guarded wrapper...');
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'shared', 'geo-guard.js'), path.join(binDir, 'geo-guard.js'));
  fs.copyFileSync(path.join(__dirname, 'claude-safe.js'), path.join(binDir, 'claude-safe.js'));
  const cmdContent = `@echo off\r\nnode "%~dp0claude-safe.js" %*\r\n`;
  fs.writeFileSync(path.join(binDir, 'claude-safe.cmd'), cmdContent, 'utf8');
  console.log(`      Installed ${path.join(binDir, 'claude-safe.cmd')}`);
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
