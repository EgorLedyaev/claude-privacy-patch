# Техническая архитектура патча (Win / macOS / Linux)

## 1. Общий слой (`shared/`)
- **`shared/platform.js`**: абстракция путей, завершения процессов и чтения политик:
  - *Claude Desktop source*: Windows (`%LOCALAPPDATA%\AnthropicClaude\app-*` Squirrel + `Get-AppxPackage` без ошибки `EPERM` на `WindowsApps`), macOS (`/Applications/Claude.app`), Linux (`/opt/Claude`, `/usr/lib/claude-desktop`, `~/.local/share/claude-desktop`).
  - *Claude Science*: конфиг `~/.claude-science/config.toml` + поиск бинарника на Win/macOS/Linux.
  - *Claude Code CLI*: динамический поиск самой свежей версии бинарника (`~/.local/bin/`, каталог `claude-code/` от Claude Desktop на всех ОС, системный `PATH`).
  - *Политики*: `HKCU\SOFTWARE\Policies\Claude` и `ClaudeCode` (Windows), `defaults write com.anthropic.claudefordesktop` / `claudecode` (macOS).
- **`shared/geo-guard.js`**: HTTPS CONNECT через настроенный локальный прокси к `ipapi.co` (fallback `ipinfo.io`), блокировка запуска при недоступности прокси или egress-стране `RU`/`BY`.
- **`shared/launch-guarded.js`**: кроссплатформенный Geo-Guard лаунчер с нативными диалогами ошибок (`MessageBox`, `osascript`, `zenity`/`notify-send`) и поддержкой `--auto-sync` (проверяет выход новой версии перед запуском).
- **`shared/firewall.js`**: на Windows управляет исходящими правилами `netsh advfirewall` для блокировки UDP на бинарниках Desktop, Science и Code CLI.

## 2. Claude Desktop (`claude-desktop/`)
- **Electron Fuses**: отключение `EnableEmbeddedAsarIntegrityValidation` и `OnlyLoadAppFromAsar` (на macOS — в `Electron Framework`, затем `codesign --force --deep --sign -`).
- **Динамическая точка входа**: читает `package.json` внутри `app.asar` (по умолчанию `.vite/build/index.pre.js`) и подключает внешний `enhancements/loader.js`.
- **Chromium DNS-Lock & WebRTC Shield**: `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--disable-webrtc-hw-decoding`.
- **Все сессии (`session-created` + `defaultSession`)**: `setProxy`, отмена запросов на домены телеметрии (`sentry.io`, `datadoghq.com`, `statsig.com`, `growthbook.io`), удаление `anthropic-device-id`, `ant-did`, `anthropic-anonymous-id`, `x-datadog-*`, `sentry-trace`, `baggage`.
- **JS Spoofing в рендерере**: подмена `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, `navigator.language(s)` при `dom-ready`.
- **Node.js `env`**: `HTTP_PROXY`, `HTTPS_PROXY`, `TZ` и официальные флаги отключения телеметрии/автоапдейтера Claude Code (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`, `DISABLE_BUG_COMMAND=1`).

## 3. Claude Science (`claude-science/`)
Учитывая встроенный в `claude-science.exe` SHA-256 манифест `shell`, конфигурация выполняется без нарушения целостности: через `~/.claude-science/config.toml`, политики ОС и Geo-Guarded лаунчер.

## 4. Claude Code CLI (`claude-code/`)
`~/.claude/settings.json` (`env`) сохраняется при любых обновлениях CLI, а обёртка `~/.local/bin/claude-safe` при каждом запуске проверяет egress IP через прокси и запускает самую новую установленную версию `claude`.
