# Claude Privacy & Anti-Detect Patch (Windows)

Полноценная CLI-утилита и набор идемпотентных патчей для **Claude Desktop**, **Claude Science** и **Claude Code CLI** на Windows (под сплит-роутинг вроде `v2raytun` без системного VPN):

- **Pre-Flight Geo-Guard**: перед запуском любого из трёх клиентов проверяет локальный прокси и внешний IP/страну. Если прокси отключён или egress-страна `RU` / `BY` — запуск блокируется с уведомлением;
- **Chromium DNS-Lock & WebRTC Shield**: `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `disable_non_proxied_udp`, `disable-webrtc-hw-decoding`;
- **Полная изоляция Electron-сессий**: `setProxy`, блокировка телеметрии (Sentry, Datadog RUM, Statsig, GrowthBook) и удаление `anthropic-device-id`, `ant-did`, `anthropic-anonymous-id`, `x-datadog-*`, `sentry-trace`, `baggage` для `defaultSession` и всех `session-created` / `fromPartition`;
- **Реальный спуфинг таймзоны и локали в JS**: `process.env.TZ`, `app.getPreferredSystemLanguages()`, `app.getLocale()`, а также переопределение `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, `navigator.language(s)` в рендерере;
- **Защита Claude Code CLI**: настройка `~/.claude/settings.json` (`HTTP_PROXY`, `HTTPS_PROXY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`), политики `HKCU\SOFTWARE\Policies\ClaudeCode` и Geo-Guarded обёртка `claude-safe.cmd`;
- **Windows Firewall UDP Kill-Switch** (`cli.js firewall enable --elevate`): блокировка исходящего UDP на уровне ядра ОС для всех бинарников Claude;
- **Устойчивость к обновлениям** и глубокая диагностика `cli.js doctor`.

---

## Быстрый старт

```cmd
npm install
node cli.js patch all
node cli.js doctor
```
Или используйте батники в корне: **`Patch-All.bat`** и **`Verify-Status.bat`**.

### Опциональный Firewall Kill-Switch (требует UAC)
```cmd
node cli.js firewall enable --elevate
```

---

## Команды CLI

```text
node cli.js patch desktop [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js patch science [--proxy URL]
node cli.js patch code    [--proxy URL] [--tz TZ]
node cli.js patch all     [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js doctor        Полный аудит (Fuses, ASAR, реестр, CLI, Firewall, реальный Egress IP)
node cli.js firewall enable|disable|status [--elevate]
```

Для запуска **Claude Code CLI** с проверкой прокси и страны используйте:
```cmd
%USERPROFILE%\.local\bin\claude-safe.cmd
```
(Добавьте `%USERPROFILE%\.local\bin` в `PATH`, чтобы вызывать `claude-safe` из любой папки.)
