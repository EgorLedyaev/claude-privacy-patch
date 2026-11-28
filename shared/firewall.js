/**
 * Firewall UDP Kill-Switch for Claude Apps
 * - Windows: manages netsh advfirewall outbound UDP block rules per binary
 * - macOS / Linux: reports status and provides safe PF / nftables hints
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PLATFORM, getDesktopTarget, getSciencePaths, findClaudeCodeExe } = require('./platform');

const RULE_PREFIX = 'ClaudePrivacyPatch_BlockUDP_';

function isAdmin() {
  if (PLATFORM === 'win32') {
    try { execSync('net session', { stdio: 'ignore' }); return true; } catch { return false; }
  }
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function getTargetBinaries() {
  const bins = [];
  const dt = getDesktopTarget();
  if (fs.existsSync(dt.exePath)) bins.push({ name: 'Desktop', exe: dt.exePath });

  const sp = getSciencePaths();
  if (fs.existsSync(sp.exePath)) bins.push({ name: 'Science', exe: sp.exePath });

  if (PLATFORM === 'win32') {
    const electronBase = path.join(sp.scienceDir, 'electron');
    if (fs.existsSync(electronBase)) {
      for (const v of fs.readdirSync(electronBase)) {
        const exe = path.join(electronBase, v, 'claude-science.exe');
        if (fs.existsSync(exe)) bins.push({ name: `ScienceElectron_${v}`, exe });
      }
    }
  }

  const codeExe = findClaudeCodeExe();
  if (codeExe && fs.existsSync(codeExe)) bins.push({ name: 'ClaudeCode', exe: codeExe });
  return bins;
}

function getFirewallStatus() {
  if (PLATFORM !== 'win32') {
    return { supported: false, installed: false, rules: [] };
  }
  try {
    const out = execSync('netsh advfirewall firewall show rule name=all', { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const lines = out.split(/\r?\n/).filter(l => l.includes(RULE_PREFIX));
    return {
      supported: true,
      installed: lines.length > 0,
      rules: lines.map(l => l.replace(/^Rule Name:\s*/i, '').trim())
    };
  } catch {
    return { supported: true, installed: false, rules: [] };
  }
}

function enableFirewall(elevateIfNeeded = false) {
  if (PLATFORM !== 'win32') {
    console.log(`[Firewall] Per-binary UDP rules via netsh are Windows-only. On ${PLATFORM}, enforce WebRTC UDP blocking via Chromium flags (already active) or PF/nftables.`);
    return false;
  }

  if (!isAdmin()) {
    if (elevateIfNeeded) {
      const cliPath = path.resolve(__dirname, '..', 'cli.js');
      execSync(`powershell -NoProfile -Command "Start-Process node -ArgumentList '\"${cliPath}\" firewall enable' -Verb RunAs -Wait"`, { stdio: 'inherit' });
      return true;
    }
    throw new Error('Administrator privileges required. Run in elevated terminal or pass --elevate.');
  }

  const bins = getTargetBinaries();
  if (bins.length === 0) {
    console.log('No target Claude binaries found.');
    return false;
  }

  for (const b of bins) {
    const ruleName = `${RULE_PREFIX}${b.name}`;
    try { execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, { stdio: 'ignore' }); } catch {}
    execSync(
      `netsh advfirewall firewall add rule name="${ruleName}" dir=out action=block program="${b.exe}" protocol=UDP enable=yes`,
      { stdio: 'ignore' }
    );
    console.log(`[OK] Blocked outbound UDP: ${ruleName} -> ${b.exe}`);
  }
  return true;
}

function disableFirewall(elevateIfNeeded = false) {
  if (PLATFORM !== 'win32') {
    console.log(`[Firewall] No Windows rules on ${PLATFORM}.`);
    return false;
  }

  if (!isAdmin()) {
    if (elevateIfNeeded) {
      const cliPath = path.resolve(__dirname, '..', 'cli.js');
      execSync(`powershell -NoProfile -Command "Start-Process node -ArgumentList '\"${cliPath}\" firewall disable' -Verb RunAs -Wait"`, { stdio: 'inherit' });
      return true;
    }
    throw new Error('Administrator privileges required. Run in elevated terminal or pass --elevate.');
  }

  const status = getFirewallStatus();
  for (const ruleName of status.rules) {
    try {
      execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, { stdio: 'ignore' });
      console.log(`[OK] Removed firewall rule: ${ruleName}`);
    } catch {}
  }
  if (status.rules.length === 0) console.log('No ClaudePrivacyPatch firewall rules found.');
  return true;
}

module.exports = { isAdmin, getTargetBinaries, getFirewallStatus, enableFirewall, disableFirewall };
