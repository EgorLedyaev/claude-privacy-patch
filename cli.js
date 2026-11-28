#!/usr/bin/env node
/**
 * claude-privacy-patch CLI
 * Cross-platform (Windows, macOS, Linux) privacy, geo-guard, updater, and audit suite
 * for Claude Desktop, Claude Science, and Claude Code CLI.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const {
  PLATFORM,
  HOME,
  compareVersions,
  getDesktopTarget,
  readVersionInDir,
  findDesktopSource,
  getSciencePaths,
  findClaudeCodeExe
} = require('./shared/platform');
const { patchDesktop } = require('./claude-desktop/patch-desktop');
const { patchScience } = require('./claude-science/patch-science');
const { patchCode } = require('./claude-code/patch-code');
const { verifyEgress } = require('./shared/geo-guard');
const { getFirewallStatus, enableFirewall, disableFirewall } = require('./shared/firewall');

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const sub = args[1] || '';

function getFlag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function checkRegValue(keyPath, valueName) {
  try {
    const out = execSync(`reg query "${keyPath}" /v "${valueName}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.includes('0x1');
  } catch {
    return false;
  }
}

async function runDoctor() {
  console.log(`=== CLAUDE PRIVACY & ANTI-DETECT DOCTOR (${PLATFORM}) ===\n`);

  // 1. OS Enterprise Policies
  console.log('[1] OS Enterprise Policies:');
  if (PLATFORM === 'win32') {
    for (const hivePath of ['HKCU\\SOFTWARE\\Policies\\Claude', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode']) {
      const okAll = ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']
        .every(k => checkRegValue(hivePath, k));
      console.log(`    ${okAll ? '[OK]' : '[MISSING]'} ${hivePath} (4 flags)`);
    }
  } else if (PLATFORM === 'darwin') {
    for (const domain of ['com.anthropic.claudefordesktop', 'com.anthropic.claudecode']) {
      let ok = false;
      try {
        ok = execSync(`defaults read ${domain} disableAutoUpdates`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '1';
      } catch {}
      console.log(`    ${ok ? '[OK]' : '[WARN]'} macOS defaults ${domain}`);
    }
  } else {
    console.log('    [INFO] Linux enforces privacy/no-telemetry at runtime via loader.js & env vars.');
  }

  // 2. Claude Desktop + Fuses + ASAR deep check
  console.log('\n[2] Claude Desktop:');
  const dst = getDesktopTarget();
  const loaderPath = path.join(dst.enhancementsDir, 'loader.js');
  const cfgPath = path.join(dst.enhancementsDir, 'config.json');
  const launchJs = path.join(dst.enhancementsDir, 'launch-guarded.js');

  console.log(`    ${fs.existsSync(dst.exePath) ? '[OK]' : '[MISSING]'} binary (${dst.exePath})`);
  console.log(`    ${fs.existsSync(loaderPath) ? '[OK]' : '[MISSING]'} enhancements/loader.js`);
  console.log(`    ${fs.existsSync(launchJs) ? '[OK]' : '[MISSING]'} enhancements/launch-guarded.js (Geo-Guard + Auto-Sync)`);
  console.log(`    ${fs.existsSync(cfgPath) ? '[OK]' : '[WARN]'} enhancements/config.json`);

  if (fs.existsSync(dst.exePath)) {
    try {
      const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
      const targetBinary = PLATFORM === 'darwin'
        ? path.join(dst.dir, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework')
        : dst.exePath;
      const fuseExe = fs.existsSync(targetBinary) ? targetBinary : dst.exePath;
      const wire = await getCurrentFuseWire(fuseExe);
      const asarOff = wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === FuseState.DISABLE;
      const onlyOff = wire[FuseV1Options.OnlyLoadAppFromAsar] === FuseState.DISABLE;
      console.log(`    ${asarOff && onlyOff ? '[OK]' : '[FAIL]'} Electron Fuses disabled (integrity=${asarOff}, onlyAsar=${onlyOff})`);
    } catch (e) {
      console.log(`    [WARN] Could not inspect Electron Fuses: ${e.message}`);
    }
  }

  if (fs.existsSync(dst.asarPath)) {
    try {
      const asar = require('@electron/asar');
      const tmp = path.join(os.tmpdir(), `claude_doc_${Date.now()}`);
      asar.extractAll(dst.asarPath, tmp);

      let mainRel = path.join('.vite', 'build', 'index.pre.js');
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
        if (pkg.main) mainRel = pkg.main;
      } catch {}

      const preSrc = fs.readFileSync(path.join(tmp, mainRel), 'utf8');
      const preHooked = preSrc.includes('HOOK EXTERNAL') || preSrc.includes('loader.js');
      const buildDir = path.dirname(path.join(tmp, mainRel));
      const jsFiles = fs.existsSync(buildDir) ? fs.readdirSync(buildDir).filter(f => f.endsWith('.js')) : [];
      let netStubbed = false;
      let didDisabled = false;
      for (const f of jsFiles) {
        const fp = path.join(buildDir, f);
        if (!fs.statSync(fp).isFile()) continue;
        const s = fs.readFileSync(fp, 'utf8');
        if (s.includes('()=>({})')) netStubbed = true;
        if (/00000000-0000-0000-0000-000000000000",[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+=!1/.test(s)) didDisabled = true;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`    ${preHooked ? '[OK]' : '[FAIL]'} app.asar ${mainRel} hooked`);
      console.log(`    ${netStubbed ? '[OK]' : '[FAIL]'} app.asar networkInterfaces stubbed`);
      console.log(`    ${didDisabled ? '[OK]' : '[WARN]'} app.asar device-id attachment disabled`);
    } catch (e) {
      console.log(`    [WARN] ASAR inspection error: ${e.message}`);
    }
  }

  const src = findDesktopSource();
  const patchedVer = readVersionInDir(dst.dir);
  if (src && patchedVer) {
    if (compareVersions(src.version, patchedVer) > 0) {
      console.log(`    [INFO] Newer ${src.kind} version available (${src.version} vs patched ${patchedVer}). Run: node cli.js patch desktop --sync`);
    } else {
      console.log(`    [OK] Version in sync with ${src.kind} (${patchedVer})`);
    }
  }

  // 3. Claude Science
  console.log('\n[3] Claude Science:');
  const sp = getSciencePaths();
  console.log(`    ${fs.existsSync(sp.configFile) ? '[OK]' : '[MISSING]'} ~/.claude-science/config.toml`);
  console.log(`    ${fs.existsSync(path.join(sp.progDir, 'launch-guarded.js')) ? '[OK]' : '[MISSING]'} Geo-Guard launcher`);

  // 4. Claude Code CLI
  console.log('\n[4] Claude Code CLI:');
  const codeSettings = path.join(HOME, '.claude', 'settings.json');
  const safeBin = path.join(HOME, '.local', 'bin', PLATFORM === 'win32' ? 'claude-safe.cmd' : 'claude-safe');
  const foundCode = findClaudeCodeExe();
  let codeEnvOk = false;
  if (fs.existsSync(codeSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(codeSettings, 'utf8'));
      codeEnvOk = Boolean(s.env && s.env.HTTPS_PROXY && s.env.DISABLE_TELEMETRY === '1');
    } catch {}
  }
  console.log(`    ${codeEnvOk ? '[OK]' : '[MISSING]'} ~/.claude/settings.json (proxy + telemetry-off env)`);
  console.log(`    ${fs.existsSync(safeBin) ? '[OK]' : '[MISSING]'} ${safeBin}`);
  console.log(`    ${foundCode ? `[OK] Target CLI binary: ${foundCode}` : '[INFO] Standalone CLI binary not detected'}`);

  // 5. Firewall
  console.log('\n[5] Firewall UDP Kill-Switch:');
  const fw = getFirewallStatus();
  if (!fw.supported) {
    console.log(`    [INFO] Per-binary netsh rules are Windows-only; ${PLATFORM} relies on Chromium WebRTC/DNS locks.`);
  } else {
    console.log(`    ${fw.installed ? `[OK] Active (${fw.rules.length} rules)` : '[INFO] Not installed (optional: run "node cli.js firewall enable --elevate")'}`);
  }

  // 6. Live Proxy & Egress Geo Check
  let proxyUrl = 'http://127.0.0.1:10809';
  try {
    if (fs.existsSync(cfgPath)) proxyUrl = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).proxy || proxyUrl;
  } catch {}
  console.log(`\n[6] Live Egress Verification (${proxyUrl}):`);
  const egress = await verifyEgress(proxyUrl);
  if (egress.ok) {
    console.log(`    [OK] Egress IP: ${egress.ip} | Country: ${egress.country} ${egress.org ? `(${egress.org})` : ''}`);
  } else {
    console.log(`    [FAIL] ${egress.message}`);
  }
  console.log('');
}

async function runUpdate(target, opts) {
  const proxyUrl = opts.proxy || process.env.CLAUDE_PROXY || 'http://127.0.0.1:10809';
  console.log(`=== SAFE UPDATE + RE-PATCH (${target} on ${PLATFORM}) ===`);
  const egress = await verifyEgress(proxyUrl);
  if (!egress.ok) {
    throw new Error(`Update aborted by Geo-Guard: ${egress.message}`);
  }
  console.log(`[Geo-Guard] Egress verified: ${egress.ip} (${egress.country})\n`);

  const proxyEnv = { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1' };

  if (target === 'desktop' || target === 'all') {
    console.log('[Update] Checking OS package manager for Claude Desktop update...');
    if (PLATFORM === 'win32') {
      spawnSync('winget', ['upgrade', 'Anthropic.Claude', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit', env: proxyEnv });
    } else if (PLATFORM === 'darwin') {
      spawnSync('brew', ['upgrade', '--cask', 'claude'], { stdio: 'inherit', env: proxyEnv });
    } else {
      console.log('      Update Claude Desktop via your Linux package manager (apt/pacman/AppImage), then --sync runs automatically.');
    }
    await patchDesktop({ ...opts, sync: true });
  }

  if (target === 'science' || target === 'all') {
    const sp = getSciencePaths();
    if (fs.existsSync(sp.cliPath)) {
      console.log('[Update] Running claude-science update via proxy...');
      spawnSync(sp.cliPath, ['update'], { stdio: 'inherit', env: proxyEnv });
    }
    await patchScience(opts);
  }

  if (target === 'code' || target === 'all') {
    const codeExe = findClaudeCodeExe();
    if (codeExe) {
      console.log('[Update] Running claude update via proxy...');
      spawnSync(codeExe, ['update'], { stdio: 'inherit', env: proxyEnv });
    }
    await patchCode(opts);
  }
}

function printHelp() {
  console.log(`claude-privacy-patch — Cross-Platform Privacy, Geo-Guard & Auto-Patch Suite (Win/macOS/Linux)

USAGE:
  node cli.js patch  <desktop|science|code|all> [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js update <desktop|science|code|all> [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js doctor                             Full audit (Fuses, ASAR, Registry/Defaults, CLI, Egress IP)
  node cli.js firewall <enable|disable|status> [--elevate]
`);
}

async function main() {
  const opts = {
    sync: args.includes('--sync'),
    proxy: getFlag('--proxy', undefined),
    tz: getFlag('--tz', undefined),
    lang: getFlag('--lang', undefined)
  };

  if (cmd === 'patch') {
    if (sub === 'desktop') await patchDesktop(opts);
    else if (sub === 'science') await patchScience(opts);
    else if (sub === 'code') await patchCode(opts);
    else if (sub === 'all' || !sub) {
      await patchDesktop(opts);
      await patchScience(opts);
      await patchCode(opts);
    } else {
      printHelp();
      process.exit(1);
    }
  } else if (cmd === 'update') {
    const t = sub || 'all';
    if (!['desktop', 'science', 'code', 'all'].includes(t)) {
      printHelp();
      process.exit(1);
    }
    await runUpdate(t, opts);
  } else if (cmd === 'doctor' || cmd === 'status' || cmd === 'verify') {
    await runDoctor();
  } else if (cmd === 'firewall') {
    const elevate = args.includes('--elevate');
    if (sub === 'enable') enableFirewall(elevate);
    else if (sub === 'disable') disableFirewall(elevate);
    else {
      const fw = getFirewallStatus();
      if (!fw.supported) console.log(`Firewall netsh rules are Windows-only (current OS: ${PLATFORM}).`);
      else {
        console.log('Firewall UDP Kill-Switch:', fw.installed ? `ACTIVE (${fw.rules.length} rules)` : 'INACTIVE');
        for (const r of fw.rules) console.log(' -', r);
      }
    }
  } else {
    printHelp();
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
