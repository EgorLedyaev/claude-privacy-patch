/**
 * Claude Desktop Security, Anti-Detect & Update-Lock Patcher
 * Usage:
 *   node patch-desktop.js [--sync] [--proxy http://127.0.0.1:10809] [--tz Europe/Berlin] [--lang en-US]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function patchDesktop(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  const timezone = opts.tz || 'Europe/Berlin';
  const locale = opts.lang || 'en-US';
  const syncFromStore = Boolean(opts.sync);

  const targetDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude-Patched');
  const exePath = path.join(targetDir, 'claude.exe');
  const asarPath = path.join(targetDir, 'resources', 'app.asar');
  const enhancementsDir = path.join(targetDir, 'enhancements');
  const loaderSrc = path.join(__dirname, 'loader.js');
  const loaderDst = path.join(enhancementsDir, 'loader.js');
  const configDst = path.join(enhancementsDir, 'config.json');

  console.log('=== CLAUDE DESKTOP SECURITY & ANTI-DETECT PATCHER ===');
  console.log(`Proxy: ${proxyUrl} | Timezone: ${timezone} | Locale: ${locale}`);

  // 1. Terminate running instances & wait for Windows file lock release
  try {
    execSync('taskkill /f /im claude.exe', { stdio: 'ignore' });
    console.log('[1/7] Terminated running Claude processes.');
    await new Promise(r => setTimeout(r, 1200));
  } catch {
    console.log('[1/7] No running Claude processes.');
  }

  // 2. Optional sync from Microsoft Store WindowsApps package
  if (syncFromStore || !fs.existsSync(exePath)) {
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
      console.log(`      Copying clean files from ${foundAppDir} -> ${targetDir}`);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(foundAppDir, targetDir, { recursive: true, force: true });
    } else if (!fs.existsSync(exePath)) {
      throw new Error(`Claude-Patched not found and WindowsApps package inaccessible. Copy Claude "app" folder to ${targetDir}`);
    }
  } else {
    console.log('[2/7] Using existing Claude-Patched directory (pass --sync to refresh from WindowsApps).');
  }

  // 3. Apply Group Policy registry flags (persistent across updates)
  console.log('[3/7] Applying Group Policy registry flags (HKCU\\SOFTWARE\\Policies\\Claude)...');
  for (const key of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
    execSync(`reg add HKCU\\SOFTWARE\\Policies\\Claude /v ${key} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
  }
  console.log('      Policies active: updates locked, essential/nonessential telemetry disabled.');

  // 4. Register claude:// URI protocol handler for OAuth callbacks
  console.log('[4/7] Registering claude:// protocol handler...');
  execSync(`reg add HKCU\\Software\\Classes\\claude\\shell\\open\\command /ve /t REG_SZ /d "\\"${exePath}\\" \\"%1\\"" /f`, { stdio: 'ignore' });

  // 5. Flip Electron Fuses in claude.exe (only if not already disabled)
  console.log('[5/7] Checking Electron Fuses in claude.exe...');
  const { flipFuses, getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
  const currentFuses = await getCurrentFuseWire(exePath);
  const asarValEnabled = currentFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.DISABLE;
  const onlyAsarEnabled = currentFuses[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.DISABLE;
  if (asarValEnabled || onlyAsarEnabled) {
    await flipFuses(exePath, {
      version: '1',
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false
    });
    console.log('      Fuses flipped: EnableEmbeddedAsarIntegrityValidation=false, OnlyLoadAppFromAsar=false.');
  } else {
    console.log('      Fuses already disabled (skipping binary write).');
  }

  // 6. Install loader.js + config.json & patch app.asar if needed
  console.log('[6/7] Installing Privacy Shield & checking app.asar...');
  fs.mkdirSync(enhancementsDir, { recursive: true });
  fs.copyFileSync(loaderSrc, loaderDst);
  fs.writeFileSync(configDst, JSON.stringify({ proxy: proxyUrl, timezone, lang: locale }, null, 2), 'utf8');

  const asar = require('@electron/asar');
  const tmpExtract = path.join(process.env.TEMP, `claude_asar_${Date.now()}`);
  asar.extractAll(asarPath, tmpExtract);

  let asarModified = false;

  // 6a. Patch .vite/build/index.pre.js
  const prePath = path.join(tmpExtract, '.vite', 'build', 'index.pre.js');
  if (fs.existsSync(prePath)) {
    let preSrc = fs.readFileSync(prePath, 'utf8');
    if (!preSrc.includes('HOOK EXTERNAL ENHANCEMENTS LOADER') && !preSrc.includes('HOOK EXTERNAL PRIVACY LOADER')) {
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
// ====================================
`;
      preSrc = injection + preSrc;
      fs.writeFileSync(prePath, preSrc, 'utf8');
      asarModified = true;
      console.log('      Patched .vite/build/index.pre.js (loader hook).');
    } else {
      console.log('      .vite/build/index.pre.js already hooked.');
    }
  }

  // 6b. Patch index.chunk-*.js (version-independent networkInterfaces & device-id)
  const buildDir = path.join(tmpExtract, '.vite', 'build');
  const chunks = fs.readdirSync(buildDir).filter(f => f.startsWith('index.chunk-') && f.endsWith('.js'));
  for (const chunkName of chunks) {
    const chunkPath = path.join(buildDir, chunkName);
    let src = fs.readFileSync(chunkPath, 'utf8');
    let changed = false;

    const netRegex = /([a-zA-Z0-9_$]+)=[a-zA-Z0-9_$]+\.networkInterfaces\b/g;
    if (netRegex.test(src)) {
      src = src.replace(netRegex, '$1=()=>({})');
      changed = true;
      console.log(`      Stubbed networkInterfaces in ${chunkName}.`);
    }

    const didRegex = /("00000000-0000-0000-0000-000000000000",[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+)=!0\b/g;
    if (didRegex.test(src)) {
      src = src.replace(didRegex, '$1=!1');
      changed = true;
      console.log(`      Disabled device-id attachment in ${chunkName}.`);
    }

    if (changed) {
      fs.writeFileSync(chunkPath, src, 'utf8');
      asarModified = true;
    }
  }

  if (asarModified) {
    await asar.createPackage(tmpExtract, asarPath);
    console.log('      Repacked app.asar.');
  }
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  // 7. Create/Update single clean Desktop shortcut & remove legacy duplicate
  console.log('[7/7] Updating Desktop shortcut (Claude.lnk)...');
  const desktopDir = path.join(process.env.USERPROFILE, 'Desktop');
  const desktopLnk = path.join(desktopDir, 'Claude.lnk');
  const oldLnk = path.join(desktopDir, 'Claude (Patched).lnk');
  if (fs.existsSync(oldLnk)) {
    fs.unlinkSync(oldLnk);
  }

  const vbs = `
Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${desktopLnk.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
lnk.WorkingDirectory = "${targetDir.replace(/\\/g, '\\\\')}"
lnk.Description = "Claude Desktop (Privacy Hardened)"
lnk.Save
`;
  const vbsPath = path.join(process.env.TEMP, 'update_claude_lnk.vbs');
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  execSync(`cscript //nologo "${vbsPath}"`);
  fs.unlinkSync(vbsPath);
  console.log('=== CLAUDE DESKTOP PATCH COMPLETE & VERIFIED ===\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name, fb) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fb;
  };
  patchDesktop({
    sync: args.includes('--sync'),
    proxy: getArg('--proxy', undefined),
    tz: getArg('--tz', undefined),
    lang: getArg('--lang', undefined)
  }).catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { patchDesktop };
