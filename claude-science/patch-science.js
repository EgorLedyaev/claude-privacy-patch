/**
 * Claude Science Privacy, Proxy & Update-Lock Configurator
 * Uses native config.toml + process-scoped proxy launcher + Group Policy flags
 * so claude-science.exe's internal SHA256 runtime manifest check is never triggered.
 *
 * Usage:
 *   node patch-science.js [--proxy http://127.0.0.1:10809]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function patchScience(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';

  const home = process.env.USERPROFILE;
  const scienceDir = path.join(home, '.claude-science');
  const progDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'ClaudeScience');
  const exePath = path.join(progDir, 'claude-science.exe');
  const cliPath = path.join(progDir, 'claude-science.com');
  const configFile = path.join(scienceDir, 'config.toml');
  const launcherVbs = path.join(progDir, 'run-claude-science.vbs');
  const desktopLnk = path.join(home, 'Desktop', 'Claude Science.lnk');

  console.log('=== CLAUDE SCIENCE PRIVACY & PROXY CONFIGURATOR ===');
  console.log(`Proxy: ${proxyUrl}`);

  // 1. Stop running daemon/app cleanly
  console.log('[1/4] Stopping running Claude Science daemon (if active)...');
  try {
    if (fs.existsSync(cliPath)) {
      execSync(`"${cliPath}" stop`, { stdio: 'ignore' });
    }
    execSync('taskkill /f /im claude-science.exe', { stdio: 'ignore' });
  } catch {}

  // 2. Write ~/.claude-science/config.toml
  console.log('[2/4] Writing ~/.claude-science/config.toml...');
  fs.mkdirSync(scienceDir, { recursive: true });
  const configToml = `[network]
proxy = "${proxyUrl}"

[update]
auto_update = false

[conda]
ssl_no_revoke = true
`;
  fs.writeFileSync(configFile, configToml, 'utf8');
  console.log(`      Saved ${configFile}`);

  // 3. Ensure HKCU\SOFTWARE\Policies\Claude flags
  console.log('[3/4] Enforcing Group Policy flags (HKCU\\SOFTWARE\\Policies\\Claude)...');
  for (const key of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
    execSync(`reg add HKCU\\SOFTWARE\\Policies\\Claude /v ${key} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
  }

  // 4. Install Geo-Guarded process-scoped proxy launcher & update Desktop shortcut
  console.log('[4/4] Installing Geo-Guarded launcher & updating Desktop shortcut...');
  if (!fs.existsSync(progDir)) {
    console.warn(`      WARNING: ${progDir} not found. Install Claude Science first, then re-run this script.`);
  } else {
    fs.copyFileSync(path.join(__dirname, '..', 'shared', 'geo-guard.js'), path.join(progDir, 'geo-guard.js'));
    fs.copyFileSync(path.join(__dirname, '..', 'shared', 'launch-guarded.js'), path.join(progDir, 'launch-guarded.js'));
    const launchJs = path.join(progDir, 'launch-guarded.js');

    const vbsLauncher = `Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "${progDir}"
oShell.Run "node ""${launchJs}"" --target ""${exePath}"" --cwd ""${progDir}"" --proxy ""${proxyUrl}"" --title ""Claude Science"" --env ""HTTP_PROXY=${proxyUrl}"" --env ""HTTPS_PROXY=${proxyUrl}"" --env ""NO_PROXY=localhost,127.0.0.1"" --env ""TZ=Europe/Berlin""", 0, False
`;
    fs.writeFileSync(launcherVbs, vbsLauncher, 'utf8');

    const updateShortcutVbs = `Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${desktopLnk.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """${launcherVbs.replace(/\\/g, '\\\\')}"""
lnk.WorkingDirectory = "${progDir.replace(/\\/g, '\\\\')}"
lnk.IconLocation = "${exePath.replace(/\\/g, '\\\\')},0"
lnk.Description = "Claude Science (Proxy & Privacy Protected)"
lnk.Save
`;
    const tmpVbs = path.join(process.env.TEMP, 'update_science_lnk.vbs');
    fs.writeFileSync(tmpVbs, updateShortcutVbs, 'utf8');
    execSync(`cscript //nologo "${tmpVbs}"`);
    fs.unlinkSync(tmpVbs);
    console.log(`      Updated shortcut: ${desktopLnk}`);
  }

  console.log('=== CLAUDE SCIENCE CONFIGURATION COMPLETE ===\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pIdx = args.indexOf('--proxy');
  const proxy = pIdx !== -1 && args[pIdx + 1] ? args[pIdx + 1] : undefined;
  patchScience({ proxy }).catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { patchScience };
