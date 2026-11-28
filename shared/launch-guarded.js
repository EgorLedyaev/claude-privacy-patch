/**
 * Geo-Guarded Process Launcher
 * Usage:
 *   node launch-guarded.js --target <exe> --cwd <dir> --proxy <url> [--title <name>] [--env KEY=VAL ...]
 */
const { spawn, execFileSync } = require('child_process');
const { verifyEgress } = require('./geo-guard');

function showErrorPopup(title, message) {
  try {
    const safeTitle = String(title).replace(/'/g, "''");
    const safeMsg = String(message).replace(/'/g, "''");
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command',
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safeMsg}', '${safeTitle}', 'OK', 'Error') | Out-Null`
    ], { stdio: 'ignore' });
  } catch {
    console.error(`[${title}] ${message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let target = '';
  let cwd = '';
  let proxy = 'http://127.0.0.1:10809';
  let title = 'Claude Privacy Guard';
  const extraEnv = {};
  const passArgs = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target') target = args[++i];
    else if (a === '--cwd') cwd = args[++i];
    else if (a === '--proxy') proxy = args[++i];
    else if (a === '--title') title = args[++i];
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

  const child = spawn(target, passArgs, {
    cwd: cwd || undefined,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv }
  });
  child.unref();
}

main();
