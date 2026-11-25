# Claude Privacy & Anti-Detect Patch (Windows)

Полноценная CLI-утилита и набор идемпотентных патчей для **Claude Desktop** и **Claude Science** на Windows:
- **Принудительный прокси** (`--proxy`, по умолчанию `http://127.0.0.1:10809`) для Chromium, **всех** Electron-сессий (`defaultSession` + `session-created` / `fromPartition`), Node.js-окружения (`HTTP_PROXY`/`HTTPS_PROXY`) и демона Claude Science;
- **Защита от сетевых и аппаратных утечек**: заглушка `os.networkInterfaces()` в рантайме и бандле, удаление `anthropic-device-id`, `ant-did`, `anthropic-anonymous-id`;
- **Защита от WebRTC-утечек**: `disable_non_proxied_udp` и `disable-webrtc-hw-decoding`;
- **Спуфинг таймзоны и локали**: `timezone` + `lang` + переопределение `app.getPreferredSystemLanguages()`, `app.getLocale()`, `app.getSystemLocale()`;
- **Блокировка телеметрии**: Sentry, Datadog RUM, Statsig, GrowthBook + удаление трассировочных заголовков (`x-datadog-*`, `sentry-trace`, `baggage`);
- **Устойчивость к обновлениям**: Group Policy в `HKCU\SOFTWARE\Policies\Claude`, изолированная папка `Claude-Patched`, нативный `config.toml`, динамический `enhancements/config.json` и встроенный аудит `status`.

---

## Структура репозитория

```text
claude-privacy-patch/
├── cli.js                                # Единый CLI (patch desktop/science/all, status)
├── package.json                          # Зависимости (@electron/asar, @electron/fuses)
├── Patch-All.bat                         # 1-Click патч для Desktop + Science
├── Verify-Status.bat                     # 1-Click аудит всех защит и прокси
├── README.md                             # Документация
├── docs/
│   └── ARCHITECTURE.md                   # Технический разбор векторов и защиты
├── claude-desktop/
│   ├── patch-desktop.js                  # Патчер Claude Desktop (--sync, Fuses, ASAR, реестр)
│   ├── loader.js                         # Main-process Privacy Shield (все сессии + окна)
│   └── Patch-Claude-Desktop.bat          # 1-Click патч только для Claude Desktop
└── claude-science/
    ├── patch-science.js                  # Конфигуратор Claude Science
    ├── config.toml.example               # Шаблон ~/.claude-science/config.toml
    ├── run-claude-science.vbs            # Лаунчер с изоляцией HTTP_PROXY / HTTPS_PROXY
    └── Patch-Claude-Science.bat          # 1-Click настройка только для Claude Science
```

---

## Быстрый старт

1. Установите зависимости:
   ```cmd
   npm install
   ```

2. Запустите общий патч (или отдельные батники):
   ```cmd
   node cli.js patch all
   ```
   Или кликните **`Patch-All.bat`**.

3. Проверьте статус всех защит и доступность прокси:
   ```cmd
   node cli.js status
   ```
   Или кликните **`Verify-Status.bat`**.

---

## Команды CLI

```text
node cli.js patch desktop [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js patch science [--proxy URL]
node cli.js patch all     [--sync] [--proxy URL] [--tz TZ] [--lang LANG]
node cli.js status
```

- `--sync` — подтянуть свежие файлы Claude Desktop из установленного пакета `C:\Program Files\WindowsApps\Claude_*` в `%LOCALAPPDATA%\Programs\Claude-Patched` и заново пропатчить.
- `--proxy` — адрес локального HTTP-прокси (по умолчанию `http://127.0.0.1:10809`). Для Claude Desktop параметры сохраняются в `enhancements/config.json`, поэтому сменить прокси можно без перепаковки `app.asar`.
- `--tz` / `--lang` — таймзона и язык Chromium/Electron (по умолчанию `Europe/Berlin` и `en-US`).

---

## Проверка работы

- Запускайте приложения через обновлённые ярлыки **`Claude`** и **`Claude Science`** на Рабочем столе (при включённом `v2raytun`).
- Для проверки Claude Science убедитесь, что в логах (`claude-science.com logs`) присутствует строка:
  `[proxy] proxy from environment — ... https via http://127.0.0.1:10809 (HTTPS_PROXY), http via http://127.0.0.1:10809 (HTTP_PROXY)`.
