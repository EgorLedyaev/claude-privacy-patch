/**
 * Claude Desktop Privacy & Anti-Detect Shield (Main Process)
 * - Blocks telemetry domains (Sentry, Datadog, Statsig)
 * - Strips device-id and tracing headers
 * - Ensures window visibility and second-instance focus
 */
const { app, session, BrowserWindow } = require('electron');

const BLOCKED_HOSTS = [
  'sentry.io',
  'ingest.sentry.io',
  'ingest.us.sentry.io',
  'datadoghq.com',
  'browser-intake-datadoghq.com',
  'statsig.com',
  'statsigapi.net'
];

function initPrivacyShield() {
  // Restore/focus existing window on second launch
  app.on('second-instance', () => {
    try {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const win = windows[0];
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    } catch (e) {}
  });

  // Guarantee window visibility when created
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
    } catch (e) {}
  });

  // Network privacy hooks
  app.on('ready', () => {
    if (session && session.defaultSession) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        try {
          const url = new URL(details.url);
          if (BLOCKED_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
            return callback({ cancel: true });
          }
        } catch (e) {}
        callback({ cancel: false });
      });

      session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        delete headers['anthropic-device-id'];
        delete headers['ant-did'];
        delete headers['x-datadog-trace-id'];
        delete headers['x-datadog-parent-id'];
        delete headers['x-datadog-origin'];
        delete headers['x-datadog-sampling-priority'];
        delete headers['sentry-trace'];
        delete headers['baggage'];
        callback({ requestHeaders: headers });
      });
    }
  });
}

module.exports = initPrivacyShield;
