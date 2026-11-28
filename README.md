# Claude Privacy & Anti-Detect Patch (Windows / macOS / Linux)

Кроссплатформенная CLI-утилита и набор идемпотентных патчей для **Claude Desktop**, **Claude Science** и **Claude Code CLI** (под сплит-роутинг вроде `v2raytun` / `nekoray` / `sing-box` без системного VPN):

- **Мультиплатформенность (Windows, macOS, Linux)**: единая архитектура путей и обёрток для всех трёх ОС;
- **Auto-Sync при запуске (`--auto-sync`)**: лаунчер Claude Desktop сравнивает версию установленного клиента (Squirrel `%LOCALAPPDATA%\AnthropicClaude\app-*`, Microsoft Store через `Get-AppxPackage`, macOS `/Applications/Claude.app`, Linux `/opt/Claude` и др.) с пропатченной копией и **сам перенакатывает патчи перед стартом**, если вышло обновление;
- **Безопасное обновление в 1 команду (`cli.js update`)**: обновляет Desktop (`winget`/`brew`), Science (`claude-science update`) и Code CLI (`claude update`) строго через проверенный прокси и сразу переприменяет все патчи;
- **Pre-Flight Geo-Guard**: перед запуском любого клиента проверяет локальный прокси (`127.0.0.1:10809`) и реальный egress IP/страну — при падении прокси или стране `RU`/`BY` запуск блокируется окном ошибки;
- **Chromium DNS-Lock & WebRTC Shield**: `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `disable_non_proxied_udp`, `disable-webrtc-hw-decoding`;
- **Полная изоляция Electron-сессий**: `setProxy`, блокировка телеметрии (Sentry, Datadog RUM, Statsig, GrowthBook) и удаление `anthropic-device-id`, `ant-did`, `anthropic-anonymous-id`, `x-datadog-*`, `sentry-trace`, `baggage` для `defaultSession` и всех `session-created` / `fromPartition`;
- **Реальный спуфинг таймзоны и локали в JS**: `process.env.TZ`, `app.getPreferredSystemLanguages()`, `app.getLocale()`, а также переопределение `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, `navigator.language(s)` в рендерере;
- **Защита Claude Code CLI**: `~/.claude/settings.json` + политики + обёртка `claude-safe`, которая динамически находит самую свежую версию `claude` даже после автообновления;
- **Windows Firewall UDP Kill-Switch**: `node cli.js firewall enable --elevate`.

---

## Быстрый старт

### Windows
```cmd
npm install
node cli.js patch all
node cli.js doctor
```
Или в 1 клик через батники: **`Patch-All.bat`**, **`Update-All.bat`**, **`Verify-Status.bat`**.

### macOS / Linux
```bash
npm install
chmod +x patch-all.sh update-all.sh cli.js
./patch-all.sh
node cli.js doctor
```
После установки:
- **macOS**: используйте `~/Applications/Claude-Patched.app` (подписано ad-hoc `codesign`) или обёртки `~/.local/bin/claude-desktop-safe`, `~/.local/bin/claude-science-safe`, `~/.local/bin/claude-safe`.
- **Linux**: создаются ярлыки в `~/.local/share/applications/` и обёртки в `~/.local/bin/`.

---

## Команды CLI

```text
node cli.js patch  <desktop|science|code|all> [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js update <desktop|science|code|all> [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js doctor                             Полный аудит (Fuses, ASAR, политики, CLI, Egress IP)
node cli.js firewall <enable|disable|status> [--elevate]
```

### Как теперь обновляться
* **Автоматически**: если Claude обновился в фоне через `.exe`-инсталлятор или Store — ярлык **`Claude`** при следующем запуске сам обнаружит новую версию, за 3–4 секунды пересоберёт пропатченную копию и запустит её.
* **Вручную одной командой**:
  ```cmd
  node cli.js update all
  ```
  (или `Update-All.bat` / `./update-all.sh`) — обновит клиенты через прокси и сразу перенакатит все защиты.
