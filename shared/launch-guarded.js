/**
 * Cross-Platform Geo-Guarded & Auto-Syncing Launcher
 * Usage:
 *   node launch-guarded.js --target <exe> --cwd <dir> --proxy <url> [--title <name>] [--auto-sync] [--repo <repoDir>] [--env KEY=VAL ...]
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { verifyEgress } = require('./geo-guard');

function showErrorPopup(title, message) {
  try {
    if (process.platform === 'win32') {
      const safeTitle = String(title).replace(/'/g, "''");
      const safeMsg = String(message).replace(/'/g, "''");
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-Command',
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safeMsg}', '${safeTitle}', 'OK', 'Error') | Out-Null`
      ], { stdio: 'ignore' });
      return;
    }
    if (process.platform === 'darwin') {
      const safeTitle = String(title).replace(/"/g, '\\"');
      const safeMsg = String(message).replace(/"/g, '\\"');
      execFileSync('osascript', ['-e', `display alert "${safeTitle}" message "${safeMsg}" as critical`], { stdio: 'ignore' });
      return;
    }
    try {
      execFileSync('zenity', ['--error', '--title', title, '--text', message], { stdio: 'ignore' });
      return;
    } catch {}
    try {
      execFileSync('notify-send', ['-u', 'critical', title, message], { stdio: 'ignore' });
    } catch {}
  } catch {}
  console.error(`[${title}] ${message}`);
}

async function tryAutoSyncDesktop(repoDir, proxyUrl) {
  if (!repoDir || !fs.existsSync(path.join(repoDir, 'claude-desktop', 'patch-desktop.js'))) return;
  try {
    const { findDesktopSource, getDesktopTarget, readVersionInDir, compareVersions } = require(path.join(repoDir, 'shared', 'platform.js'));
    const src = findDesktopSource();
    if (!src) return;
    const dst = getDesktopTarget();
    const curVer = readVersionInDir(dst.dir);
    if (!curVer || compareVersions(src.version, curVer) > 0) {
      console.log(`[Auto-Sync] New Claude Desktop detected (${src.version} > ${curVer || 'none'}). Re-patching...`);
      const { patchDesktop } = require(path.join(repoDir, 'claude-desktop', 'patch-desktop.js'));
      await patchDesktop({ sync: true, proxy: proxyUrl });
    }
  } catch (e) {
    console.warn('[Auto-Sync] Skipped:', e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let target = '';
  let cwd = '';
  let proxy = 'http://127.0.0.1:10809';
  let title = 'Claude Privacy Guard';
  let autoSync = false;
  let repoDir = '';
  const extraEnv = {};
  const passArgs = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target') target = args[++i];
    else if (a === '--cwd') cwd = args[++i];
    else if (a === '--proxy') proxy = args[++i];
    else if (a === '--title') title = args[++i];
    else if (a === '--auto-sync') autoSync = true;
    else if (a === '--repo') repoDir = args[++i];
    else if (a === '--env') {
      const kv = args[++i] || '';
      const eq = kv.indexOf('=');
      if (eq !== -1) extraEnv[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--') {
      passArgs.push(...args.slice(i + 1));
      break;
    }
  }

  if (!target) {
    console.error('Missing --target <exe>');
    process.exit(1);
  }

  const check = await verifyEgress(proxy);
  if (!check.ok) {
    showErrorPopup(title, `Launch blocked by Privacy Guard:\n\n${check.message}`);
    process.exit(2);
  }

  if (autoSync) {
    await tryAutoSyncDesktop(repoDir, proxy);
  }

  const child = spawn(target, passArgs, {
    cwd: cwd || undefined,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv }
  });
  child.unref();
}

main();
