/**
 * Cross-platform path discovery, version comparison, process control,
 * and managed policy helpers for Windows, macOS, and Linux.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
const HOME = os.homedir();

function compareVersions(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split(/[^0-9]+/).map(Number);
  const pb = String(b || '0').replace(/^v/i, '').split(/[^0-9]+/).map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function terminateProcess(names) {
  let killed = false;
  for (const name of names) {
    try {
      if (PLATFORM === 'win32') {
        execSync(`taskkill /f /im "${name}"`, { stdio: 'ignore' });
      } else {
        execSync(`pkill -f "${name}"`, { stdio: 'ignore' });
      }
      killed = true;
    } catch {}
  }
  if (killed) {
    await new Promise(r => setTimeout(r, 1200));
  }
  return killed;
}

function getDesktopTarget() {
  if (PLATFORM === 'win32') {
    const dir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude-Patched');
    return {
      dir,
      exePath: path.join(dir, 'claude.exe'),
      asarPath: path.join(dir, 'resources', 'app.asar'),
      enhancementsDir: path.join(dir, 'enhancements'),
      versionFile: path.join(dir, 'version')
    };
  }
  if (PLATFORM === 'darwin') {
    const appDir = path.join(HOME, 'Applications', 'Claude-Patched.app');
    const contents = path.join(appDir, 'Contents');
    return {
      dir: appDir,
      contentsDir: contents,
      exePath: path.join(contents, 'MacOS', 'Claude'),
      asarPath: path.join(contents, 'Resources', 'app.asar'),
      enhancementsDir: path.join(contents, 'enhancements'),
      versionFile: path.join(contents, 'enhancements', 'version')
    };
  }
  // linux
  const dir = path.join(HOME, '.local', 'share', 'claude-patched');
  const exeCandidate = fs.existsSync(path.join(dir, 'claude-desktop'))
    ? path.join(dir, 'claude-desktop')
    : path.join(dir, 'claude');
  return {
    dir,
    exePath: exeCandidate,
    asarPath: path.join(dir, 'resources', 'app.asar'),
    enhancementsDir: path.join(dir, 'enhancements'),
    versionFile: path.join(dir, 'version')
  };
}

function readAsarAppVersion(asarPath) {
  if (!fs.existsSync(asarPath)) return null;
  let fd;
  try {
    fd = fs.openSync(asarPath, 'r');
    const hdrBuf = Buffer.alloc(16);
    if (fs.readSync(fd, hdrBuf, 0, 16, 0) < 16) return null;
    const pickleSize = hdrBuf.readUInt32LE(4);
    const jsonSize = hdrBuf.readUInt32LE(12);
    if (jsonSize <= 0 || jsonSize > 32 * 1024 * 1024) return null;
    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const hdr = JSON.parse(jsonBuf.toString('utf8'));
    const pkgEntry = hdr.files && hdr.files['package.json'];
    if (!pkgEntry) return null;
    const dataOffset = 8 + pickleSize + parseInt(pkgEntry.offset, 10);
    const pkgBuf = Buffer.alloc(pkgEntry.size);
    fs.readSync(fd, pkgBuf, 0, pkgEntry.size, dataOffset);
    return JSON.parse(pkgBuf.toString('utf8')).version || null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function readVersionInDir(appDir) {
  for (const rel of [path.join('resources', 'app.asar'), path.join('Contents', 'Resources', 'app.asar')]) {
    const ver = readAsarAppVersion(path.join(appDir, rel));
    if (ver) return ver;
  }
  const plist = path.join(appDir, 'Contents', 'Info.plist');
  if (fs.existsSync(plist)) {
    const txt = fs.readFileSync(plist, 'utf8');
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(txt);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Discovers installed unpatched Claude Desktop across Windows (Squirrel + MSIX),
 * macOS (/Applications/Claude.app), and Linux standard install paths.
 */
function findDesktopSource() {
  const candidates = [];

  if (PLATFORM === 'win32') {
    // 1. Standard Squirrel .exe installer (%LOCALAPPDATA%\AnthropicClaude\app-*)
    const squirrelRoot = path.join(process.env.LOCALAPPDATA, 'AnthropicClaude');
    if (fs.existsSync(squirrelRoot)) {
      for (const d of fs.readdirSync(squirrelRoot)) {
        if (!d.startsWith('app-')) continue;
        const appDir = path.join(squirrelRoot, d);
        const exe = path.join(appDir, 'claude.exe');
        if (fs.existsSync(exe)) {
          candidates.push({
            kind: 'squirrel',
            version: d.slice(4),
            appDir,
            exeName: 'claude.exe'
          });
        }
      }
    }

    // 2. Microsoft Store MSIX (via Get-AppxPackage to avoid WindowsApps EPERM)
    try {
      const psOut = execSync(
        'powershell -NoProfile -Command "$p = Get-AppxPackage -Name \'*claude*\' | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { Write-Output ($p.Version + \'|\' + $p.InstallLocation) }"',
        { stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString('utf8').trim();
      if (psOut && psOut.includes('|')) {
        const [ver, loc] = psOut.split('|').map(s => s.trim());
        const appDir = path.join(loc, 'app');
        if (fs.existsSync(path.join(appDir, 'claude.exe'))) {
          candidates.push({
            kind: 'msix',
            version: readVersionInDir(appDir) || ver,
            appDir,
            exeName: 'claude.exe'
          });
        }
      }
    } catch {}
  } else if (PLATFORM === 'darwin') {
    for (const base of ['/Applications/Claude.app', path.join(HOME, 'Applications', 'Claude.app')]) {
      if (fs.existsSync(path.join(base, 'Contents', 'Resources', 'app.asar'))) {
        candidates.push({
          kind: 'macos-app',
          version: readVersionInDir(base) || '0.0.0',
          appDir: base,
          exeName: 'Claude'
        });
      }
    }
  } else {
    for (const base of ['/opt/Claude', '/usr/lib/claude-desktop', '/usr/share/claude-desktop', path.join(HOME, '.local', 'share', 'claude-desktop')]) {
      if (fs.existsSync(path.join(base, 'resources', 'app.asar'))) {
        candidates.push({
          kind: 'linux-dir',
          version: readVersionInDir(base) || '0.0.0',
          appDir: base,
          exeName: fs.existsSync(path.join(base, 'claude-desktop')) ? 'claude-desktop' : 'claude'
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0];
}

function getSciencePaths() {
  const scienceDir = path.join(HOME, '.claude-science');
  const configFile = path.join(scienceDir, 'config.toml');

  if (PLATFORM === 'win32') {
    const progDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'ClaudeScience');
    return {
      scienceDir,
      configFile,
      progDir,
      exePath: path.join(progDir, 'claude-science.exe'),
      cliPath: path.join(progDir, 'claude-science.com')
    };
  }
  if (PLATFORM === 'darwin') {
    let exePath = path.join(HOME, '.local', 'bin', 'claude-science');
    for (const c of [
      '/Applications/Claude Science.app/Contents/MacOS/claude-science',
      path.join(HOME, 'Applications', 'Claude Science.app', 'Contents', 'MacOS', 'claude-science'),
      '/usr/local/bin/claude-science',
      '/opt/homebrew/bin/claude-science'
    ]) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    return {
      scienceDir,
      configFile,
      progDir: path.dirname(exePath),
      exePath,
      cliPath: exePath
    };
  }
  let exePath = path.join(HOME, '.local', 'bin', 'claude-science');
  for (const c of [exePath, '/usr/local/bin/claude-science', '/usr/bin/claude-science', '/opt/claude-science/claude-science']) {
    if (fs.existsSync(c)) { exePath = c; break; }
  }
  return {
    scienceDir,
    configFile,
    progDir: path.dirname(exePath),
    exePath,
    cliPath: exePath
  };
}

function findClaudeCodeExe() {
  const binName = PLATFORM === 'win32' ? 'claude.exe' : 'claude';
  const found = [];

  // 1. Standard user local bin
  const localBin = path.join(HOME, '.local', 'bin', binName);
  if (fs.existsSync(localBin)) found.push({ version: '9999.0.0', path: localBin });

  // 2. Embedded in Claude Desktop claude-code folder
  const desktopDataRoots = PLATFORM === 'win32'
    ? [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')]
    : PLATFORM === 'darwin'
      ? [path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code')]
      : [path.join(HOME, '.config', 'Claude', 'claude-code')];

  for (const base of desktopDataRoots) {
    if (!base || !fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base)) {
      const vDir = path.join(base, ver);
      if (!fs.statSync(vDir).isDirectory()) continue;
      for (const sub of fs.readdirSync(vDir)) {
        const candidate = path.join(vDir, sub, binName);
        if (fs.existsSync(candidate)) {
          found.push({ version: ver, path: candidate });
        }
      }
    }
  }

  // 3. System / npm PATH
  try {
    const cmd = PLATFORM === 'win32' ? 'where.exe claude.exe' : 'which claude';
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
    if (out) {
      for (const line of out.split(/\r?\n/)) {
        const p = line.trim();
        if (p && !p.includes('claude-safe')) found.push({ version: '0.0.0', path: p });
      }
    }
  } catch {}

  if (found.length === 0) return null;
  found.sort((a, b) => compareVersions(b.version, a.version));
  return found[0].path;
}

function applyEnterprisePolicies(product) {
  if (PLATFORM === 'win32') {
    const regKey = product === 'code' ? 'HKCU\\SOFTWARE\\Policies\\ClaudeCode' : 'HKCU\\SOFTWARE\\Policies\\Claude';
    for (const valName of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
      execSync(`reg add "${regKey}" /v ${valName} /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
    }
    return true;
  }
  if (PLATFORM === 'darwin') {
    const domain = product === 'code' ? 'com.anthropic.claudecode' : 'com.anthropic.claudefordesktop';
    try {
      for (const valName of ['disableAutoUpdates', 'disableEssentialTelemetry', 'disableNonessentialTelemetry', 'disableNonessentialServices']) {
        execSync(`defaults write ${domain} ${valName} -bool true`, { stdio: 'ignore' });
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

module.exports = {
  PLATFORM,
  HOME,
  compareVersions,
  terminateProcess,
  getDesktopTarget,
  readVersionInDir,
  findDesktopSource,
  getSciencePaths,
  findClaudeCodeExe,
  applyEnterprisePolicies
};
