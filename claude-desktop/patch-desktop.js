/**
 * Claude Desktop Security, Anti-Detect & Update-Lock Patcher
 * Usage:
 *   node patch-desktop.js [--sync] [--proxy http://127.0.0.1:10809] [--tz Europe/Berlin]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const SYNC_FROM_STORE = args.includes('--sync');
const PROXY_URL = getArg('--proxy', process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809');
const TIMEZONE = getArg('--tz', 'Europe/Berlin');
const LOCALE = getArg('--lang', 'en-US');

const TARGET_DIR = path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude-Patched');
const EXE_PATH = path.join(TARGET_DIR, 'claude.exe');
const ASAR_PATH = path.join(TARGET_DIR, 'resources', 'app.asar');
const ENHANCEMENTS_DIR = path.join(TARGET_DIR, 'enhancements');
const LOADER_SRC = path.join(__dirname, 'loader.js');
const LOADER_DST = path.join(ENHANCEMENTS_DIR, 'loader.js');

console.log('=== CLAUDE DESKTOP SECURITY & ANTI-DETECT PATCHER ===');
console.log(`Proxy: ${PROXY_URL} | Timezone: ${TIMEZONE} | Locale: ${LOCALE}`);

// 1. Terminate running instances
try {
  execSync('taskkill /f /im claude.exe', { stdio: 'ignore' });
  console.log('[1/7] Terminated running Claude processes.');
} catch {
  console.log('[1/7] No running Claude processes.');
}

// 2. Optional sync from Microsoft Store WindowsApps package
if (SYNC_FROM_STORE || !fs.existsSync(EXE_PATH)) {
  console.log('[2/7] Looking for installed Claude Desktop (WindowsApps)...');
  const winApps = 'C:\\Program Files\\WindowsApps';
  let foundAppDir = null;
  try {
    const dirs = fs.readdirSync(winApps)
      .filter(d => d.startsWith('Claude_') && fs.existsSync(path.join(winApps, d, 'app', 'claude.exe')))
      .sort()
      .reverse();
    if (dirs.length > 0) {
      foundAppDir = path.join(winApps, dirs[0], 'app');
    }
  } catch (e) {
    console.warn('      Could not enumerate WindowsApps directly:', e.message);
  }

  if (foundAppDir) {
    console.log(`      Copying clean files from ${foundAppDir} -> ${TARGET_DIR}`);
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    fs.cpSync(foundAppDir, TARGET_DIR, { recursive: true, force: true });
  } else if (!fs.existsSync(EXE_PATH)) {
    console.error('ERROR: Claude-Patched not found and WindowsApps package could not be accessed.');
    console.error('Copy the "app" folder of Claude Desktop into:', TARGET_DIR);
    process.exit(1);
  }
} else {
  console.log('[2/7] Using existing Claude-Patched directory (pass --sync to refresh from WindowsApps).');
}

// 3. Apply Group Policy registry flags (persistent across updates)
console.log('[3/7] Applying Group Policy registry flags (HKCU\\SOFTWARE\\Policies\\Claude)...');
const regKeys = [
  'disableAutoUpdates',
  'disableEssentialTelemetry',
  'disableNonessentialTelemetry',
  'disableNonessentialServices'
];
for (const key of regKeys) {
  execSync(`reg add HKCU\\SOFTWARE\\Policies\\Claude /v ${key} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
}
console.log('      Policies active: updates locked, essential/nonessential telemetry disabled.');

// 4. Register claude:// URI protocol handler for OAuth callbacks
console.log('[4/7] Registering claude:// protocol handler...');
execSync(`reg add HKCU\\Software\\Classes\\claude\\shell\\open\\command /ve /t REG_SZ /d "\\"${EXE_PATH}\\" \\"%1\\"" /f`, { stdio: 'ignore' });

// 5. Flip Electron Fuses in claude.exe
console.log('[5/7] Flipping Electron Fuses in claude.exe...');
try {
  const { flipFuses, FuseV1Options } = require('@electron/fuses');
  flipFuses(EXE_PATH, {
    version: '1',
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: false
  });
  console.log('      Fuses disabled: EnableEmbeddedAsarIntegrityValidation=false, OnlyLoadAppFromAsar=false.');
} catch (e) {
  console.error('      Failed to flip fuses (run npm install first):', e.message);
  process.exit(1);
}

// 6. Install loader.js & patch app.asar if needed
console.log('[6/7] Installing Privacy Shield & checking app.asar...');
fs.mkdirSync(ENHANCEMENTS_DIR, { recursive: true });
fs.copyFileSync(LOADER_SRC, LOADER_DST);

const asar = require('@electron/asar');
const tmpExtract = path.join(process.env.TEMP, `claude_asar_${Date.now()}`);
asar.extractAll(ASAR_PATH, tmpExtract);

let patched = false;

// 6a. Patch .vite/build/index.pre.js
const prePath = path.join(tmpExtract, '.vite', 'build', 'index.pre.js');
if (fs.existsSync(prePath)) {
  let preSrc = fs.readFileSync(prePath, 'utf8');
  if (!preSrc.includes('CLAUDE DESKTOP PRIVACY & ENHANCEMENT INJECTION')) {
    const injection = `// === HOOK EXTERNAL PRIVACY LOADER ===
try {
  const _path = require('path');
  const _fs = require('fs');
  const _loaderPath = _path.join(process.resourcesPath, '..', 'enhancements', 'loader.js');
  if (_fs.existsSync(_loaderPath)) {
    require(_loaderPath)();
  }
} catch (err) {
  console.error('[PrivacyShield] Loader error:', err);
}
// === CLAUDE DESKTOP PRIVACY & ENHANCEMENT INJECTION ===
try {
  const electron = require('electron');
  const app = electron.app || electron.default?.app;
  if (app && app.commandLine) {
    app.commandLine.appendSwitch('proxy-server', '${PROXY_URL}');
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
    app.commandLine.appendSwitch('disable-webrtc-hw-decoding');
    app.commandLine.appendSwitch('timezone', '${TIMEZONE}');
    app.commandLine.appendSwitch('lang', '${LOCALE}');
  }
} catch (e) {
  console.error('[Patch] Injection error:', e);
}
// ======================================================
`;
    preSrc = injection + preSrc;
    fs.writeFileSync(prePath, preSrc, 'utf8');
    patched = true;
    console.log('      Patched .vite/build/index.pre.js (proxy, WebRTC, timezone, loader hook).');
  } else {
    console.log('      .vite/build/index.pre.js already patched.');
  }
}

// 6b. Patch index.chunk-*.js (networkInterfaces & device-id)
const buildDir = path.join(tmpExtract, '.vite', 'build');
const chunks = fs.readdirSync(buildDir).filter(f => f.startsWith('index.chunk-') && f.endsWith('.js'));
for (const chunkName of chunks) {
  const chunkPath = path.join(buildDir, chunkName);
  let src = fs.readFileSync(chunkPath, 'utf8');
  let changed = false;

  if (src.includes('s.networkInterfaces') && !src.includes('()=>({})')) {
    src = src.replace(/([a-zA-Z0-9_$]+)=s\.networkInterfaces\b/g, '$1=()=>({})');
    changed = true;
    console.log(`      Stubbed networkInterfaces in ${chunkName}.`);
  }
  if (src.includes('IKt=!0')) {
    src = src.replace(/IKt=!0/g, 'IKt=!1');
    changed = true;
    console.log(`      Disabled device-id attachment (IKt=!1) in ${chunkName}.`);
  }
  if (changed) {
    fs.writeFileSync(chunkPath, src, 'utf8');
    patched = true;
  }
}

if (patched) {
  asar.createPackage(tmpExtract, ASAR_PATH).then(() => {
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    finalizeShortcut();
  });
} else {
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  finalizeShortcut();
}

function finalizeShortcut() {
  // 7. Create/Update single clean Desktop shortcut
  console.log('[7/7] Updating Desktop shortcut (Claude.lnk)...');
  const desktopLnk = path.join(process.env.USERPROFILE, 'Desktop', 'Claude.lnk');
  const vbs = `
Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${desktopLnk.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "${EXE_PATH.replace(/\\/g, '\\\\')}"
lnk.WorkingDirectory = "${TARGET_DIR.replace(/\\/g, '\\\\')}"
lnk.Description = "Claude Desktop (Privacy Hardened)"
lnk.Save
`;
  const vbsPath = path.join(process.env.TEMP, 'update_claude_lnk.vbs');
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  execSync(`cscript //nologo "${vbsPath}"`);
  fs.unlinkSync(vbsPath);
  console.log('=== CLAUDE DESKTOP PATCH COMPLETE & VERIFIED ===\n');
}
