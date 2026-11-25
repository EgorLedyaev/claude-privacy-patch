#!/usr/bin/env node
/**
 * claude-privacy-patch CLI
 * Unified tool to harden and audit Claude Desktop & Claude Science on Windows.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const { patchDesktop } = require('./claude-desktop/patch-desktop');
const { patchScience } = require('./claude-science/patch-science');

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

function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 1500 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function runStatus() {
  console.log('=== CLAUDE PRIVACY & ANTI-DETECT AUDIT ===\n');

  // 1. Registry Policies
  console.log('[1] Windows Registry Policies (HKCU\\SOFTWARE\\Policies\\Claude):');
  for (const key of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
    const ok = checkRegValue('HKCU\\SOFTWARE\\Policies\\Claude', key);
    console.log(`    ${ok ? '[OK]' : '[MISSING]'} ${key}`);
  }

  // 2. Claude Desktop
  console.log('\n[2] Claude Desktop (Claude-Patched):');
  const desktopDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude-Patched');
  const exePath = path.join(desktopDir, 'claude.exe');
  const loaderPath = path.join(desktopDir, 'enhancements', 'loader.js');
  const cfgPath = path.join(desktopDir, 'enhancements', 'config.json');
  console.log(`    ${fs.existsSync(exePath) ? '[OK]' : '[MISSING]'} claude.exe`);
  console.log(`    ${fs.existsSync(loaderPath) ? '[OK]' : '[MISSING]'} enhancements/loader.js`);
  console.log(`    ${fs.existsSync(cfgPath) ? '[OK]' : '[WARN]'} enhancements/config.json`);
  if (fs.existsSync(cfgPath)) {
    console.log(`      Config: ${fs.readFileSync(cfgPath, 'utf8').replace(/\s+/g, ' ')}`);
  }

  try {
    const proto = execSync('reg query "HKCU\\Software\\Classes\\claude\\shell\\open\\command" /ve', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    console.log(`    ${proto.includes('Claude-Patched') ? '[OK]' : '[WARN]'} claude:// handler -> ${proto.trim().split(/\s+/).slice(-2).join(' ')}`);
  } catch {
    console.log('    [MISSING] claude:// URI handler');
  }

  // 3. Claude Science
  console.log('\n[3] Claude Science:');
  const scienceCfg = path.join(process.env.USERPROFILE, '.claude-science', 'config.toml');
  const scienceVbs = path.join(process.env.LOCALAPPDATA, 'Programs', 'ClaudeScience', 'run-claude-science.vbs');
  console.log(`    ${fs.existsSync(scienceCfg) ? '[OK]' : '[MISSING]'} ~/.claude-science/config.toml`);
  console.log(`    ${fs.existsSync(scienceVbs) ? '[OK]' : '[MISSING]'} run-claude-science.vbs`);

  // 4. Local Proxy Check
  let proxyHost = '127.0.0.1';
  let proxyPort = 10809;
  try {
    if (fs.existsSync(cfgPath)) {
      const u = new URL(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).proxy);
      proxyHost = u.hostname;
      proxyPort = Number(u.port) || 10809;
    }
  } catch {}
  const proxyUp = await checkPort(proxyHost, proxyPort);
  console.log(`\n[4] Local Proxy (${proxyHost}:${proxyPort}):`);
  console.log(`    ${proxyUp ? '[OK] Listening and reachable' : '[WARN] Not listening (start v2raytun before launching Claude!)'}\n`);
}

function printHelp() {
  console.log(`claude-privacy-patch — Privacy & Anti-Detect Suite for Claude Desktop & Claude Science

USAGE:
  node cli.js patch desktop [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js patch science [--proxy URL]
  node cli.js patch all     [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
  node cli.js status        Audit all patches, registry flags, and proxy reachability
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
    else if (sub === 'all' || !sub) {
      await patchDesktop(opts);
      await patchScience(opts);
    } else {
      printHelp();
      process.exit(1);
    }
  } else if (cmd === 'status' || cmd === 'verify') {
    await runStatus();
  } else {
    printHelp();
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
