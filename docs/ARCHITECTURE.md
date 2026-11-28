# Техническая архитектура патча

## 1. Pre-Flight Geo-Guard (`shared/geo-guard.js`, `shared/launch-guarded.js`)
Перед запуском `claude.exe` (Desktop), `claude-science.exe` (Science) или `claude.exe` (Code CLI) выполняется HTTPS CONNECT-запрос строго через настроенный локальный прокси (`127.0.0.1:10809`) к сервисам определения геопозиции (`ipapi.co`, fallback `ipinfo.io`).
- Если прокси не слушает порт — запуск блокируется.
- Если egress-страна `RU` или `BY` (например, сервер в `v2raytun` отключён или сплит-роутинг пропустил трафик напрямую) — запуск блокируется с системным окном ошибки.

## 2. Claude Desktop (`claude-desktop/`)
- **Electron Fuses**: отключение `EnableEmbeddedAsarIntegrityValidation` и `OnlyLoadAppFromAsar`.
- **Chromium DNS-Lock**: `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` запрещает Chromium локально резолвить внешние домены, направляя весь DNS-трафик в прокси.
- **Все сессии (`session-created` + `defaultSession`)**: `setProxy`, блокировка телеметрии и очистка `anthropic-device-id` / `ant-did` / `anthropic-anonymous-id` / `x-datadog-*` / `sentry-trace`.
- **Рендерер JS Spoofing**: в `web-contents-created` → `dom-ready` инжектится переопределение `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset` (с динамическим расчётом DST для целевой таймзоны), `navigator.language` и `navigator.languages`.
- **Встроенный Claude Code & MCP**: в `process.env` выставляются `HTTP_PROXY`, `HTTPS_PROXY`, `TZ`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`, `DISABLE_BUG_COMMAND=1`.
- **Устойчивость к обновлениям**: параметры вынесены в `enhancements/config.json`, патчи `index.chunk-*.js` используют структурные регулярки, политики прописаны в `HKCU\SOFTWARE\Policies\Claude`.

## 3. Claude Science (`claude-science/`)
Учитывая встроенный в `claude-science.exe` SHA-256 манифест для `runtime/<ver>/shell/`, конфигурация прокси и запрет автообновлений задаются нативно через `~/.claude-science/config.toml`, политики `HKCU\SOFTWARE\Policies\Claude` и Geo-Guarded лаунчер `run-claude-science.vbs`.

## 4. Claude Code CLI (`claude-code/`)
- **`~/.claude/settings.json`**: блок `env` с прокси, `TZ` и официальными флагами отключения телеметрии/автообновлений (сохраняется при обновлениях CLI).
- **`HKCU\SOFTWARE\Policies\ClaudeCode`**: корпоративные политики в реестре Windows.
- **`claude-safe.cmd`**: Geo-Guarded обёртка в `~/.local/bin/`, автоматически находящая `claude.exe` (в `PATH`, `~/.local/bin` или `%APPDATA%\Claude\claude-code\`).

## 5. Windows Firewall UDP Kill-Switch (`shared/firewall.js`)
Опциональная команда `cli.js firewall enable --elevate` создаёт исходящие правила `netsh advfirewall` с действием `block` для `protocol=UDP` на все бинарники Claude Desktop, Claude Science (включая `electron/*/claude-science.exe`) и Claude Code CLI.
