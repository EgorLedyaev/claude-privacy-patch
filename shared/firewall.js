/**
 * Windows Defender Firewall Kill-Switch for Claude Apps
 * Blocks all direct outbound UDP traffic (eliminating WebRTC/STUN/QUIC leaks)
 * for Claude Desktop, Claude Science, and Claude Code CLI binaries.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RULE_PREFIX = 'ClaudePrivacyPatch_BlockUDP_';

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getTargetBinaries() {
  const bins = [];
  const localAppData = process.env.LOCALAPPDATA;
  const home = process.env.USERPROFILE;
  const appData = process.env.APPDATA;

  const candidates = [
    { name: 'Desktop', exe: path.join(localAppData, 'Programs', 'Claude-Patched', 'claude.exe') },
    { name: 'ScienceDaemon', exe: path.join(localAppData, 'Programs', 'ClaudeScience', 'claude-science.exe') }
  ];

  // Electron runtime for Claude Science
  const electronBase = path.join(home, '.claude-science', 'electron');
  if (fs.existsSync(electronBase)) {
    for (const v of fs.readdirSync(electronBase)) {
      const exe = path.join(electronBase, v, 'claude-science.exe');
      if (fs.existsSync(exe)) {
        candidates.push({ name: `ScienceElectron_${v}`, exe });
      }
    }
  }

  // Claude Code CLI binaries
  const codeBase = path.join(appData, 'Claude', 'claude-code');
  if (fs.existsSync(codeBase)) {
    const findExe = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) findExe(full);
        else if (ent.name === 'claude.exe') {
          candidates.push({ name: `ClaudeCode_${path.basename(path.dirname(path.dirname(full)))}`, exe: full });
        }
      }
    };
    findExe(codeBase);
  }

  for (const c of candidates) {
    if (fs.existsSync(c.exe)) bins.push(c);
  }
  return bins;
}

function getFirewallStatus() {
  try {
    const out = execSync(`netsh advfirewall firewall show rule name=all`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const lines = out.split(/\r?\n/).filter(l => l.includes(RULE_PREFIX));
    return {
      installed: lines.length > 0,
      rules: lines.map(l => l.replace(/^Rule Name:\s*/i, '').trim())
    };
  } catch {
    return { installed: false, rules: [] };
  }
}

function enableFirewall(elevateIfNeeded = false) {
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
  if (status.rules.length === 0) {
    console.log('No ClaudePrivacyPatch firewall rules found.');
  }
  return true;
}

module.exports = { isAdmin, getTargetBinaries, getFirewallStatus, enableFirewall, disableFirewall };
