/**
 * Shared Proxy & Geo-Egress Guard
 * Verifies that the local HTTP proxy is reachable AND that external egress IP
 * resolves outside restricted regions (RU / BY) before allowing apps to start.
 */
const net = require('net');
const tls = require('tls');
const http = require('http');

const BLOCKED_COUNTRIES = new Set(['RU', 'BY']);

function checkPort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function httpsGetViaProxy(proxyHost, proxyPort, targetHost, targetPath, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:443`,
      timeout: timeoutMs
    });

    req.on('timeout', () => {
      req.destroy(new Error('Proxy CONNECT timeout'));
    });
    req.on('error', reject);

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT returned HTTP ${res.statusCode}`));
      }

      const tlsSock = tls.connect({
        socket,
        servername: targetHost,
        timeout: timeoutMs
      }, () => {
        tlsSock.write(
          `GET ${targetPath} HTTP/1.1\r\n` +
          `Host: ${targetHost}\r\n` +
          `User-Agent: curl/8.0\r\n` +
          `Accept: application/json\r\n` +
          `Connection: close\r\n\r\n`
        );
      });

      let raw = '';
      tlsSock.setEncoding('utf8');
      tlsSock.on('data', chunk => { raw += chunk; });
      tlsSock.on('timeout', () => { tlsSock.destroy(new Error('TLS timeout')); });
      tlsSock.on('error', reject);
      tlsSock.on('end', () => {
        const sep = raw.indexOf('\r\n\r\n');
        if (sep === -1) return reject(new Error('Malformed HTTP response'));
        const body = raw.slice(sep + 4).trim();
        // Handle chunked encoding if present
        const jsonStart = body.indexOf('{');
        const jsonEnd = body.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          return reject(new Error('No JSON in geo response'));
        }
        try {
          resolve(JSON.parse(body.slice(jsonStart, jsonEnd + 1)));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.end();
  });
}

async function verifyEgress(proxyUrl = 'http://127.0.0.1:10809') {
  let proxyHost = '127.0.0.1';
  let proxyPort = 10809;
  try {
    const u = new URL(proxyUrl);
    proxyHost = u.hostname;
    proxyPort = Number(u.port) || 10809;
  } catch {}

  const portOpen = await checkPort(proxyHost, proxyPort);
  if (!portOpen) {
    return {
      ok: false,
      reason: 'proxy_unreachable',
      message: `Local proxy ${proxyHost}:${proxyPort} is not listening. Start v2raytun first.`
    };
  }

  const providers = [
    { host: 'ipapi.co', path: '/json/', parse: d => ({ ip: d.ip, country: d.country_code, org: d.org }) },
    { host: 'ipinfo.io', path: '/json', parse: d => ({ ip: d.ip, country: d.country, org: d.org }) }
  ];

  let lastErr = null;
  for (const p of providers) {
    try {
      const data = await httpsGetViaProxy(proxyHost, proxyPort, p.host, p.path);
      const info = p.parse(data);
      if (info.ip && info.country) {
        const code = String(info.country).toUpperCase();
        if (BLOCKED_COUNTRIES.has(code)) {
          return {
            ok: false,
            reason: 'blocked_country',
            ip: info.ip,
            country: code,
            message: `Blocked egress country ${code} (${info.ip}). Switch VPN node before launching.`
          };
        }
        return {
          ok: true,
          ip: info.ip,
          country: code,
          org: info.org || ''
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }

  return {
    ok: false,
    reason: 'geo_check_failed',
    message: `Proxy is open, but egress verification failed (${lastErr ? lastErr.message : 'unknown error'}). Refusing direct launch.`
  };
}

module.exports = { checkPort, verifyEgress, BLOCKED_COUNTRIES };
