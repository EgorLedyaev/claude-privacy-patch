/**
 * Claude Desktop Privacy & Anti-Detect Shield (Main Process)
 * Runs before app initialization via index.pre.js hook.
 * - Reads runtime config from enhancements/config.json
 * - Stubs os.networkInterfaces() and locale getters
 * - Enforces proxy on Chromium command line, Node env, and all Electron sessions
 * - Blocks telemetry domains (Sentry, Datadog, Statsig, GrowthBook)
 * - Strips device-id and tracing headers on all sessions
 * - Ensures window visibility and second-instance focus
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, session, BrowserWindow } = require('electron');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  const defaults = {
    proxy: 'http://127.0.0.1:10809',
    timezone: 'Europe/Berlin',
    lang: 'en-US'
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {}
  return defaults;
}

const BLOCKED_HOSTS = [
  'sentry.io',
  'ingest.sentry.io',
  'ingest.us.sentry.io',
  'datadoghq.com',
  'browser-intake-datadoghq.com',
  'statsig.com',
  'statsigapi.net',
  'growthbook.io'
];

const STRIPPED_HEADERS = [
  'anthropic-device-id',
  'ant-did',
  'anthropic-anonymous-id',
  'x-datadog-trace-id',
  'x-datadog-parent-id',
  'x-datadog-origin',
  'x-datadog-sampling-priority',
  'sentry-trace',
  'baggage'
];

const hookedSessions = new WeakSet();

function hardenSession(sess, proxyUrl) {
  if (!sess || hookedSessions.has(sess)) return;
  hookedSessions.add(sess);

  if (proxyUrl && typeof sess.setProxy === 'function') {
    sess.setProxy({ proxyRules: proxyUrl, proxyBypassRules: 'localhost,127.0.0.1' }).catch(() => {});
  }

  sess.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      if (BLOCKED_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
        return callback({ cancel: true });
      }
    } catch {}
    callback({ cancel: false });
  });

  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) {
      if (STRIPPED_HEADERS.includes(key.toLowerCase())) {
        delete headers[key];
      }
    }
    callback({ requestHeaders: headers });
  });
}

function initPrivacyShield() {
  const cfg = loadConfig();

  // 1. Runtime OS & Locale spoofing (version-independent)
  try {
    os.networkInterfaces = () => ({});
  } catch {}

  if (cfg.proxy) {
    process.env.HTTP_PROXY = cfg.proxy;
    process.env.HTTPS_PROXY = cfg.proxy;
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
  }

  if (app && app.commandLine) {
    if (cfg.proxy) app.commandLine.appendSwitch('proxy-server', cfg.proxy);
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
    app.commandLine.appendSwitch('disable-webrtc-hw-decoding');
    if (cfg.timezone) app.commandLine.appendSwitch('timezone', cfg.timezone);
    if (cfg.lang) app.commandLine.appendSwitch('lang', cfg.lang);
  }

  if (app && cfg.lang) {
    const shortLang = cfg.lang.split('-')[0];
    app.getPreferredSystemLanguages = () => [cfg.lang, shortLang];
    app.getLocale = () => cfg.lang;
    if (typeof app.getSystemLocale === 'function') {
      app.getSystemLocale = () => cfg.lang;
    }
  }

  // 2. Restore/focus existing window on second launch
  app.on('second-instance', () => {
    try {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const win = windows[0];
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    } catch {}
  });

  // 3. Guarantee window visibility when created
  app.on('browser-window-created', (_evt, win) => {
    try {
      if (win && !win.isDestroyed()) {
        win.once('ready-to-show', () => {
          win.show();
          win.focus();
        });
        setTimeout(() => {
          if (win && !win.isDestroyed() && !win.isVisible()) {
            win.show();
            win.focus();
          }
        }, 1200);
      }
    } catch {}
  });

  // 4. Harden defaultSession AND every custom/partitioned session
  app.on('session-created', (sess) => {
    hardenSession(sess, cfg.proxy);
  });

  app.on('ready', () => {
    if (session && session.defaultSession) {
      hardenSession(session.defaultSession, cfg.proxy);
    }
  });
}

module.exports = initPrivacyShield;
