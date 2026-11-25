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

const args = process.argv.slice(2);
const pIdx = args.indexOf('--proxy');
const PROXY_URL = pIdx !== -1 && args[pIdx + 1] ? args[pIdx + 1] : (process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809');

const HOME = process.env.USERPROFILE;
const SCIENCE_DIR = path.join(HOME, '.claude-science');
const PROG_DIR = path.join(process.env.LOCALAPPDATA, 'Programs', 'ClaudeScience');
const EXE_PATH = path.join(PROG_DIR, 'claude-science.exe');
const CLI_PATH = path.join(PROG_DIR, 'claude-science.com');
const CONFIG_FILE = path.join(SCIENCE_DIR, 'config.toml');
const LAUNCHER_VBS = path.join(PROG_DIR, 'run-claude-science.vbs');
const DESKTOP_LNK = path.join(HOME, 'Desktop', 'Claude Science.lnk');

console.log('=== CLAUDE SCIENCE PRIVACY & PROXY CONFIGURATOR ===');
console.log(`Proxy: ${PROXY_URL}`);

// 1. Stop running daemon/app cleanly
console.log('[1/4] Stopping running Claude Science daemon (if active)...');
try {
  if (fs.existsSync(CLI_PATH)) {
    execSync(`"${CLI_PATH}" stop`, { stdio: 'ignore' });
  }
  execSync('taskkill /f /im claude-science.exe', { stdio: 'ignore' });
} catch {}

// 2. Write ~/.claude-science/config.toml
console.log('[2/4] Writing ~/.claude-science/config.toml...');
fs.mkdirSync(SCIENCE_DIR, { recursive: true });
const configToml = `[network]
proxy = "${PROXY_URL}"

[update]
auto_update = false

[conda]
ssl_no_revoke = true
`;
fs.writeFileSync(CONFIG_FILE, configToml, 'utf8');
console.log(`      Saved ${CONFIG_FILE}`);

// 3. Ensure HKCU\SOFTWARE\Policies\Claude flags
console.log('[3/4] Enforcing Group Policy flags (HKCU\\SOFTWARE\\Policies\\Claude)...');
for (const key of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
  execSync(`reg add HKCU\\SOFTWARE\\Policies\\Claude /v ${key} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
}

// 4. Install process-scoped proxy launcher & update Desktop shortcut
console.log('[4/4] Installing protected launcher & updating Desktop shortcut...');
if (!fs.existsSync(PROG_DIR)) {
  console.warn(`      WARNING: ${PROG_DIR} not found. Install Claude Science first, then re-run this script.`);
} else {
  const vbsLauncher = `Set oShell = CreateObject("WScript.Shell")
Set oEnv = oShell.Environment("PROCESS")

oEnv("HTTP_PROXY") = "${PROXY_URL}"
oEnv("HTTPS_PROXY") = "${PROXY_URL}"
oEnv("NO_PROXY") = "localhost,127.0.0.1"

oShell.CurrentDirectory = "${PROG_DIR}"
oShell.Run """${EXE_PATH}""", 1, False
`;
  fs.writeFileSync(LAUNCHER_VBS, vbsLauncher, 'utf8');

  const updateShortcutVbs = `Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${DESKTOP_LNK.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """${LAUNCHER_VBS.replace(/\\/g, '\\\\')}"""
lnk.WorkingDirectory = "${PROG_DIR.replace(/\\/g, '\\\\')}"
lnk.IconLocation = "${EXE_PATH.replace(/\\/g, '\\\\')},0"
lnk.Description = "Claude Science (Proxy & Privacy Protected)"
lnk.Save
`;
  const tmpVbs = path.join(process.env.TEMP, 'update_science_lnk.vbs');
  fs.writeFileSync(tmpVbs, updateShortcutVbs, 'utf8');
  execSync(`cscript //nologo "${tmpVbs}"`);
  fs.unlinkSync(tmpVbs);
  console.log(`      Updated shortcut: ${DESKTOP_LNK}`);
}

console.log('=== CLAUDE SCIENCE CONFIGURATION COMPLETE ===\n');
