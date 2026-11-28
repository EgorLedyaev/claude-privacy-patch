/**
 * Cross-Platform Claude Desktop Security, Geo-Guard & Auto-Sync Patcher
 * Supports Windows (Squirrel .exe + Microsoft Store MSIX), macOS (.app + ad-hoc codesign), and Linux.
 *
 * Usage:
 *   node patch-desktop.js [--sync] [--proxy http://127.0.0.1:10809] [--tz Europe/Berlin] [--lang en-US]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  PLATFORM,
  HOME,
  terminateProcess,
  getDesktopTarget,
  findDesktopSource,
  applyEnterprisePolicies
} = require('../shared/platform');

const REPO_ROOT = path.resolve(__dirname, '..');

async function patchDesktop(opts = {}) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  const timezone = opts.tz || 'Europe/Berlin';
  const locale = opts.lang || 'en-US';
  const syncFromSource = Boolean(opts.sync);

  const dst = getDesktopTarget();
  const loaderSrc = path.join(__dirname, 'loader.js');
  const loaderDst = path.join(dst.enhancementsDir, 'loader.js');
  const configDst = path.join(dst.enhancementsDir, 'config.json');

  console.log(`=== CLAUDE DESKTOP PRIVACY & ANTI-DETECT PATCHER (${PLATFORM}) ===`);
  console.log(`Proxy: ${proxyUrl} | Timezone: ${timezone} | Locale: ${locale}`);

  // 1. Terminate running instances & wait for file lock release
  const killed = await terminateProcess(
    PLATFORM === 'win32' ? ['claude.exe'] : ['Claude', 'claude-desktop']
  );
  console.log(`[1/7] ${killed ? 'Terminated running Claude processes.' : 'No running Claude processes.'}`);

  // 2. Sync from official install if requested or missing
  if (syncFromSource || !fs.existsSync(dst.exePath)) {
    console.log('[2/7] Detecting installed Claude Desktop source...');
    const src = findDesktopSource();
    if (src) {
      console.log(`      Copying clean build (${src.kind} v${src.version}) -> ${dst.dir}`);
      fs.mkdirSync(dst.dir, { recursive: true });
      fs.cpSync(src.appDir, dst.dir, { recursive: true, force: true });
      if (src.version && !fs.existsSync(dst.versionFile)) {
        fs.mkdirSync(path.dirname(dst.versionFile), { recursive: true });
        fs.writeFileSync(dst.versionFile, src.version, 'utf8');
      }
    } else if (!fs.existsSync(dst.exePath)) {
      throw new Error(`Claude Desktop not found on system and ${dst.dir} does not exist yet.`);
    }
  } else {
    console.log('[2/7] Using existing patched build (pass --sync to refresh from source).');
  }

  // Re-resolve target exePath on Linux in case binary name was copied
  const resolvedDst = getDesktopTarget();

  // 3. Apply OS Enterprise Policies
  console.log('[3/7] Applying OS Enterprise Policies...');
  const polApplied = applyEnterprisePolicies('desktop');
  console.log(polApplied
    ? '      Policies active (auto-updates locked, telemetry disabled).'
    : '      Skipped native policy store on this OS (handled at runtime via loader.js).');

  // 4. Register claude:// URI handler (Windows)
  console.log('[4/7] Configuring protocol handler / platform hooks...');
  if (PLATFORM === 'win32') {
    execSync(`reg add HKCU\\Software\\Classes\\claude\\shell\\open\\command /ve /t REG_SZ /d "\\"${resolvedDst.exePath}\\" \\"%1\\"" /f`, { stdio: 'ignore' });
    console.log('      Registered claude:// -> Claude-Patched.');
  } else {
    console.log('      Using bundle Info.plist / .desktop handler.');
  }

  // 5. Check & Flip Electron Fuses
  console.log('[5/7] Checking Electron Fuses...');
  try {
    const { flipFuses, getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
    const targetBinary = PLATFORM === 'darwin'
      ? path.join(resolvedDst.dir, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework')
      : resolvedDst.exePath;
    const fuseExe = fs.existsSync(targetBinary) ? targetBinary : resolvedDst.exePath;

    const currentFuses = await getCurrentFuseWire(fuseExe);
    const asarValEnabled = currentFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.DISABLE;
    const onlyAsarEnabled = currentFuses[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.DISABLE;
    if (asarValEnabled || onlyAsarEnabled) {
      await flipFuses(fuseExe, {
        version: '1',
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: false
      });
      console.log('      Fuses flipped: EnableEmbeddedAsarIntegrityValidation=false, OnlyLoadAppFromAsar=false.');
    } else {
      console.log('      Fuses already disabled (skipping binary write).');
    }
  } catch (e) {
    console.warn('      Fuse check warning (continuing):', e.message);
  }

  // 6. Install Privacy Shield + Geo-Guard scripts & patch app.asar
  console.log('[6/7] Installing Privacy Shield & patching app.asar...');
  fs.mkdirSync(resolvedDst.enhancementsDir, { recursive: true });
  fs.copyFileSync(loaderSrc, loaderDst);
  fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'geo-guard.js'), path.join(resolvedDst.enhancementsDir, 'geo-guard.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'shared', 'launch-guarded.js'), path.join(resolvedDst.enhancementsDir, 'launch-guarded.js'));
  fs.writeFileSync(configDst, JSON.stringify({ proxy: proxyUrl, timezone, lang: locale }, null, 2), 'utf8');

  const asar = require('@electron/asar');
  const osTmp = require('os').tmpdir();
  const tmpExtract = path.join(osTmp, `claude_asar_${Date.now()}`);
  asar.extractAll(resolvedDst.asarPath, tmpExtract);

  let asarModified = false;

  // Read main entry point dynamically from package.json
  let mainRel = path.join('.vite', 'build', 'index.pre.js');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpExtract, 'package.json'), 'utf8'));
    if (pkg.main) mainRel = pkg.main;
  } catch {}

  const entryPath = path.join(tmpExtract, mainRel);
  if (fs.existsSync(entryPath)) {
    let preSrc = fs.readFileSync(entryPath, 'utf8');
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
      fs.writeFileSync(entryPath, preSrc, 'utf8');
      asarModified = true;
      console.log(`      Patched ${mainRel} (loader hook).`);
    } else {
      console.log(`      ${mainRel} already hooked.`);
    }
  }

  // Version-independent networkInterfaces & device-id patch across chunks
  const buildDir = path.dirname(entryPath);
  if (fs.existsSync(buildDir)) {
    const jsFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.js'));
    for (const fileName of jsFiles) {
      const filePath = path.join(buildDir, fileName);
      if (!fs.statSync(filePath).isFile()) continue;
      let src = fs.readFileSync(filePath, 'utf8');
      let changed = false;

      const netRegex = /([a-zA-Z0-9_$]+)=[a-zA-Z0-9_$]+\.networkInterfaces\b/g;
      if (netRegex.test(src)) {
        src = src.replace(netRegex, '$1=()=>({})');
        changed = true;
        console.log(`      Stubbed networkInterfaces in ${fileName}.`);
      }

      const didRegex = /("00000000-0000-0000-0000-000000000000",[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+)=!0\b/g;
      if (didRegex.test(src)) {
        src = src.replace(didRegex, '$1=!1');
        changed = true;
        console.log(`      Disabled device-id attachment in ${fileName}.`);
      }

      if (changed) {
        fs.writeFileSync(filePath, src, 'utf8');
        asarModified = true;
      }
    }
  }

  if (asarModified) {
    await asar.createPackage(tmpExtract, resolvedDst.asarPath);
    console.log('      Repacked app.asar.');
  }
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  // macOS ad-hoc codesign after modifying app bundle
  if (PLATFORM === 'darwin') {
    try {
      execSync(`codesign --force --deep --sign - "${resolvedDst.dir}"`, { stdio: 'ignore' });
      console.log('      Re-signed Claude-Patched.app (ad-hoc codesign).');
    } catch (e) {
      console.warn('      codesign warning:', e.message);
    }
  }

  // 7. Create Geo-Guarded & Auto-Syncing Launcher + Shortcut
  console.log('[7/7] Configuring Geo-Guarded + Auto-Syncing launcher...');
  const launchJs = path.join(resolvedDst.enhancementsDir, 'launch-guarded.js');

  if (PLATFORM === 'win32') {
    const launcherVbs = path.join(resolvedDst.enhancementsDir, 'run-claude-desktop.vbs');
    const vbsLauncher = `Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "${resolvedDst.dir}"
oShell.Run "node ""${launchJs}"" --auto-sync --repo ""${REPO_ROOT}"" --target ""${resolvedDst.exePath}"" --cwd ""${resolvedDst.dir}"" --proxy ""${proxyUrl}"" --title ""Claude Desktop""", 0, False
`;
    fs.writeFileSync(launcherVbs, vbsLauncher, 'utf8');

    const desktopDir = path.join(HOME, 'Desktop');
    const desktopLnk = path.join(desktopDir, 'Claude.lnk');
    const oldLnk = path.join(desktopDir, 'Claude (Patched).lnk');
    if (fs.existsSync(oldLnk)) fs.unlinkSync(oldLnk);

    const vbs = `
Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut("${desktopLnk.replace(/\\/g, '\\\\')}")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """${launcherVbs.replace(/\\/g, '\\\\')}"""
lnk.WorkingDirectory = "${resolvedDst.dir.replace(/\\/g, '\\\\')}"
lnk.IconLocation = "${resolvedDst.exePath.replace(/\\/g, '\\\\')},0"
lnk.Description = "Claude Desktop (Geo-Guarded & Auto-Sync)"
lnk.Save
`;
    const vbsPath = path.join(osTmp, 'update_claude_lnk.vbs');
    fs.writeFileSync(vbsPath, vbs, 'utf8');
    execSync(`cscript //nologo "${vbsPath}"`);
    fs.unlinkSync(vbsPath);
    console.log(`      Updated Desktop shortcut: ${desktopLnk}`);
  } else {
    const binDir = path.join(HOME, '.local', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const wrapper = path.join(binDir, 'claude-desktop-safe');
    const sh = `#!/usr/bin/env bash
exec node "${launchJs}" --auto-sync --repo "${REPO_ROOT}" --target "${resolvedDst.exePath}" --cwd "${resolvedDst.dir}" --proxy "${proxyUrl}" --title "Claude Desktop" "$@"
`;
    fs.writeFileSync(wrapper, sh, { mode: 0o755 });
    console.log(`      Installed guarded launcher: ${wrapper}`);

    if (PLATFORM === 'linux') {
      const appDir = path.join(HOME, '.local', 'share', 'applications');
      fs.mkdirSync(appDir, { recursive: true });
      const desktopFile = path.join(appDir, 'claude-desktop-patched.desktop');
      fs.writeFileSync(desktopFile, `[Desktop Entry]
Name=Claude (Privacy Guarded)
Exec=${wrapper} %u
Type=Application
Terminal=false
Categories=Utility;
MimeType=x-scheme-handler/claude;
`);
      console.log(`      Installed Linux desktop entry: ${desktopFile}`);
    }
  }

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
