/**
 * Cross-Platform Claude Science Privacy, Proxy & Update-Lock Configurator
 * Works on Windows, macOS, and Linux.
 * Uses native config.toml + process-scoped Geo-Guarded launcher + OS policies.
 *
 * Usage:
 *   node patch-science.js [--proxy http://127.0.0.1:10809] [--tz Europe/Berlin]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  PLATFORM,
  HOME,
  terminateProcess,
  getSciencePaths,
  applyEnterprisePolicies
} = require('../shared/platform');

const REPO_ROOT = path.resolve(__dirname, '..');

async function patchScience(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  const timezone = opts.tz || 'Europe/Berlin';
  const sp = getSciencePaths();

  console.log(`=== CLAUDE SCIENCE PRIVACY & PROXY CONFIGURATOR (${PLATFORM}) ===`);
  console.log(`Proxy: ${proxyUrl} | Timezone: ${timezone}`);

  // 1. Stop running daemon/app cleanly
  console.log('[1/4] Stopping running Claude Science daemon (if active)...');
  try {
    if (fs.existsSync(sp.cliPath)) {
      execSync(`"${sp.cliPath}" stop`, { stdio: 'ignore' });
    }
  } catch {}
  await terminateProcess(['claude-science.exe', 'claude-science']);

  // 2. Write ~/.claude-science/config.toml
  console.log('[2/4] Writing ~/.claude-science/config.toml...');
  fs.mkdirSync(sp.scienceDir, { recursive: true });
  const configToml = `[network]
proxy = "${proxyUrl}"

[update]
auto_update = false

[conda]
ssl_no_revoke = true
`;
  fs.writeFileSync(sp.configFile, configToml, 'utf8');
  console.log(`      Saved ${sp.configFile}`);

  // 3. Apply OS Enterprise Policies
  console.log('[3/4] Enforcing OS Enterprise Policies...');
  applyEnterprisePolicies('science');

  // 4. Install Geo-Guarded launcher & shortcut
  console.log('[4/4] Installing Geo-Guarded launcher...');
  if (!fs.existsSync(sp.exePath)) {
    console.warn(`      WARNING: Claude Science binary not found (${sp.exePath}). Install Claude Science first, then re-run.`);
  } else {
    fs.mkdirSync(sp.progDir, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'geo-guard.js'), path.join(sp.progDir, 'geo-guard.js'));
    fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'launch-guarded.js'), path.join(sp.progDir, 'launch-guarded.js'));
    const launchJs = path.join(sp.progDir, 'launch-guarded.js');

    if (PLATFORM === 'win32') {
      const launcherVbs = path.join(sp.progDir, 'run-claude-science.vbs');
      const vbsLauncher = `Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "${sp.progDir}"
oShell.Run "node ""${launchJs}"" --target ""${sp.exePath}"" --cwd ""${sp.progDir}"" --proxy ""${proxyUrl}"" --title ""Claude Science"" --env ""HTTP_PROXY=${proxyUrl}"" --env ""HTTPS_PROXY=${proxyUrl}"" --env ""NO_PROXY=localhost,127.0.0.1"" --env ""TZ=${timezone}""", 0, False
`;
      fs.writeFileSync(launcherVbs, vbsLauncher, 'utf8');

      const desktopLnk = path.join(HOME, 'Desktop', 'Claude Science.lnk');
      const updateShortcutVbs = `Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${desktopLnk.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """${launcherVbs.replace(/\\/g, '\\\\')}"""
lnk.WorkingDirectory = "${sp.progDir.replace(/\\/g, '\\\\')}"
lnk.IconLocation = "${sp.exePath.replace(/\\/g, '\\\\')},0"
lnk.Description = "Claude Science (Proxy & Privacy Protected)"
lnk.Save
`;
      const tmpVbs = path.join(os.tmpdir(), 'update_science_lnk.vbs');
      fs.writeFileSync(tmpVbs, updateShortcutVbs, 'utf8');
      execSync(`cscript //nologo "${tmpVbs}"`);
      fs.unlinkSync(tmpVbs);
      console.log(`      Updated Desktop shortcut: ${desktopLnk}`);
    } else {
      const binDir = path.join(HOME, '.local', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const wrapper = path.join(binDir, 'claude-science-safe');
      const sh = `#!/usr/bin/env bash
exec node "${launchJs}" --target "${sp.exePath}" --cwd "${sp.progDir}" --proxy "${proxyUrl}" --title "Claude Science" --env "HTTP_PROXY=${proxyUrl}" --env "HTTPS_PROXY=${proxyUrl}" --env "NO_PROXY=localhost,127.0.0.1" --env "TZ=${timezone}" "$@"
`;
      fs.writeFileSync(wrapper, sh, { mode: 0o755 });
      console.log(`      Installed guarded launcher: ${wrapper}`);

      if (PLATFORM === 'linux') {
        const appDir = path.join(HOME, '.local', 'share', 'applications');
        fs.mkdirSync(appDir, { recursive: true });
        const df = path.join(appDir, 'claude-science-patched.desktop');
        fs.writeFileSync(df, `[Desktop Entry]\nName=Claude Science (Privacy Guarded)\nExec=${wrapper} %u\nType=Application\nTerminal=false\nCategories=Science;Education;\n`);
        console.log(`      Installed Linux desktop entry: ${df}`);
      }
    }
  }

  console.log('=== CLAUDE SCIENCE CONFIGURATION COMPLETE ===\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name, fb) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fb;
  };
  patchScience({
    proxy: getArg('--proxy', undefined),
    tz: getArg('--tz', undefined)
  }).catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { patchScience };
