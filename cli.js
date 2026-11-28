#!/usr/bin/env node
/**
 * claude-privacy-patch CLI
 * Unified tool to harden, geo-guard, and audit Claude Desktop, Claude Science, and Claude Code CLI on Windows.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
  console.log('=== CLAUDE PRIVACY & ANTI-DETECT DOCTOR ===\n');

  // 1. Registry Policies
  console.log('[1] Windows Registry Policies:');
  for (const hivePath of ['HKCU\\SOFTWARE\\Policies\\Claude', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode']) {
    const okAll = ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']
      .every(k => checkRegValue(hivePath, k));
    console.log(`    ${okAll ? '[OK]' : '[MISSING]'} ${hivePath} (4 flags)`);
  }

  // 2. Claude Desktop + Fuses + ASAR deep check
  console.log('\n[2] Claude Desktop (Claude-Patched):');
  const desktopDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude-Patched');
  const exePath = path.join(desktopDir, 'claude.exe');
  const asarPath = path.join(desktopDir, 'resources', 'app.asar');
  const loaderPath = path.join(desktopDir, 'enhancements', 'loader.js');
  const cfgPath = path.join(desktopDir, 'enhancements', 'config.json');
  const vbsDesktop = path.join(desktopDir, 'enhancements', 'run-claude-desktop.vbs');

  console.log(`    ${fs.existsSync(exePath) ? '[OK]' : '[MISSING]'} claude.exe`);
  console.log(`    ${fs.existsSync(loaderPath) ? '[OK]' : '[MISSING]'} enhancements/loader.js`);
  console.log(`    ${fs.existsSync(vbsDesktop) ? '[OK]' : '[MISSING]'} enhancements/run-claude-desktop.vbs (Geo-Guard launcher)`);
  console.log(`    ${fs.existsSync(cfgPath) ? '[OK]' : '[WARN]'} enhancements/config.json`);

  if (fs.existsSync(exePath)) {
    try {
      const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
      const wire = await getCurrentFuseWire(exePath);
      const asarOff = wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === FuseState.DISABLE;
      const onlyOff = wire[FuseV1Options.OnlyLoadAppFromAsar] === FuseState.DISABLE;
      console.log(`    ${asarOff && onlyOff ? '[OK]' : '[FAIL]'} Electron Fuses disabled (integrity=${asarOff}, onlyAsar=${onlyOff})`);
    } catch (e) {
      console.log(`    [WARN] Could not inspect Electron Fuses: ${e.message}`);
    }
  }

  if (fs.existsSync(asarPath)) {
    try {
      const asar = require('@electron/asar');
      const tmp = path.join(process.env.TEMP, `claude_doc_${Date.now()}`);
      asar.extractAll(asarPath, tmp);
      const preSrc = fs.readFileSync(path.join(tmp, '.vite', 'build', 'index.pre.js'), 'utf8');
      const preHooked = preSrc.includes('HOOK EXTERNAL') || preSrc.includes('loader.js');
      const buildDir = path.join(tmp, '.vite', 'build');
      const chunks = fs.readdirSync(buildDir).filter(f => f.startsWith('index.chunk-') && f.endsWith('.js'));
      let netStubbed = false;
      let didDisabled = false;
      for (const c of chunks) {
        const s = fs.readFileSync(path.join(buildDir, c), 'utf8');
        if (s.includes('()=>({})')) netStubbed = true;
        if (/00000000-0000-0000-0000-000000000000",[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+=!1/.test(s)) didDisabled = true;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`    ${preHooked ? '[OK]' : '[FAIL]'} app.asar index.pre.js hooked`);
      console.log(`    ${netStubbed ? '[OK]' : '[FAIL]'} app.asar networkInterfaces stubbed`);
      console.log(`    ${didDisabled ? '[OK]' : '[WARN]'} app.asar device-id attachment disabled`);
    } catch (e) {
      console.log(`    [WARN] ASAR inspection error: ${e.message}`);
    }
  }

  // Check Store version drift
  const verFile = path.join(desktopDir, 'version');
  if (fs.existsSync(verFile)) {
    const patchedVer = fs.readFileSync(verFile, 'utf8').trim();
    try {
      const storeDirs = fs.readdirSync('C:\\Program Files\\WindowsApps')
        .filter(d => d.startsWith('Claude_'))
        .sort()
        .reverse();
      if (storeDirs.length > 0) {
        const m = /^Claude_([^_]+)_/.exec(storeDirs[0]);
        if (m && m[1] !== patchedVer && !m[1].startsWith(patchedVer)) {
          console.log(`    [INFO] Newer Store version available (${m[1]} vs patched ${patchedVer}). Run: node cli.js patch desktop --sync`);
        } else {
          console.log(`    [OK] Version matches Store (${patchedVer})`);
        }
      }
    } catch {}
  }

  // 3. Claude Science
  console.log('\n[3] Claude Science:');
  const scienceCfg = path.join(process.env.USERPROFILE, '.claude-science', 'config.toml');
  const scienceVbs = path.join(process.env.LOCALAPPDATA, 'Programs', 'ClaudeScience', 'run-claude-science.vbs');
  console.log(`    ${fs.existsSync(scienceCfg) ? '[OK]' : '[MISSING]'} ~/.claude-science/config.toml`);
  console.log(`    ${fs.existsSync(scienceVbs) ? '[OK]' : '[MISSING]'} run-claude-science.vbs (Geo-Guard launcher)`);

  // 4. Claude Code CLI
  console.log('\n[4] Claude Code CLI:');
  const codeSettings = path.join(process.env.USERPROFILE, '.claude', 'settings.json');
  const claudeSafeCmd = path.join(process.env.USERPROFILE, '.local', 'bin', 'claude-safe.cmd');
  let codeEnvOk = false;
  if (fs.existsSync(codeSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(codeSettings, 'utf8'));
      codeEnvOk = Boolean(s.env && s.env.HTTPS_PROXY && s.env.DISABLE_TELEMETRY === '1');
    } catch {}
  }
  console.log(`    ${codeEnvOk ? '[OK]' : '[MISSING]'} ~/.claude/settings.json (proxy + telemetry-off env)`);
  console.log(`    ${fs.existsSync(claudeSafeCmd) ? '[OK]' : '[MISSING]'} ~/.local/bin/claude-safe.cmd`);

  // 5. Windows Firewall Kill-Switch
  console.log('\n[5] Windows Firewall UDP Kill-Switch:');
  const fw = getFirewallStatus();
  console.log(`    ${fw.installed ? `[OK] Active (${fw.rules.length} rules)` : '[INFO] Not installed (optional: run "node cli.js firewall enable --elevate")'}`);

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

function printHelp() {
  console.log(`claude-privacy-patch — Privacy, Geo-Guard & Anti-Detect Suite (Windows)

USAGE:
  node cli.js patch desktop [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js patch science [--proxy URL]
  node cli.js patch code    [--proxy URL] [--tz TZ]
  node cli.js patch all     [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js doctor        Deep audit (Fuses, ASAR, Registry, CLI, Firewall, Live Egress IP)
  node cli.js firewall enable|disable|status [--elevate]
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
  } else if (cmd === 'doctor' || cmd === 'status' || cmd === 'verify') {
    await runDoctor();
  } else if (cmd === 'firewall') {
    const elevate = args.includes('--elevate');
    if (sub === 'enable') enableFirewall(elevate);
    else if (sub === 'disable') disableFirewall(elevate);
    else {
      const fw = getFirewallStatus();
      console.log('Firewall UDP Kill-Switch:', fw.installed ? `ACTIVE (${fw.rules.length} rules)` : 'INACTIVE');
      for (const r of fw.rules) console.log(' -', r);
    }
  } else {
    printHelp();
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
