# Claude Privacy & Anti-Detect Patch (Windows)

Набор идемпотентных патчей и конфигураций для **Claude Desktop** и **Claude Science** на Windows, обеспечивающий:
- **Принудительную маршрутизацию трафика через локальный прокси** (например, `v2raytun` на `127.0.0.1:10809`) без глобального системного VPN;
- **Блокировку утечек сетевых интерфейсов и аппаратных отпечатков** (`os.networkInterfaces()`, `anthropic-device-id`, `ant-did`);
- **Защиту от WebRTC-утечек** (`disable_non_proxied_udp`, `disable-webrtc-hw-decoding`);
- **Полное отключение телеметрии** (Sentry, Datadog RUM, Statsig) и трассировочных заголовков;
- **Устойчивость к обновлениям** (реестровые политики `HKCU\SOFTWARE\Policies\Claude`, изолированная директория `Claude-Patched`, нативный `config.toml` для Claude Science и 1-Click скрипты повторного применения).

---

## Структура репозитория

```text
claude-privacy-patch/
├── package.json                          # Зависимости (@electron/asar, @electron/fuses)
├── README.md                             # Основная документация
├── docs/
│   └── ARCHITECTURE.md                   # Технический разбор механизмов и защиты
├── claude-desktop/
│   ├── patch-desktop.js                  # Главный патчер Claude Desktop
│   ├── loader.js                         # Main-process Privacy Shield (webRequest + окна)
│   └── Patch-Claude-Desktop.bat          # 1-Click запуск патчера
└── claude-science/
    ├── patch-science.js                  # Конфигуратор и защитный лаунчер Claude Science
    ├── config.toml.example               # Шаблон ~/.claude-science/config.toml
    ├── run-claude-science.vbs            # Лаунчер с изоляцией HTTP_PROXY / HTTPS_PROXY
    └── Patch-Claude-Science.bat          # 1-Click запуск конфигуратора
```

---

## Требования

- **Windows 10 / 11**
- **Node.js >= 20** (включая `npm`)
- Запущенный локальный HTTP-прокси (по умолчанию `http://127.0.0.1:10809`, например `v2raytun`)

---

## Быстрый старт

1. Установите зависимости в корне репозитория:
   ```cmd
   npm install
   ```

2. Для **Claude Desktop**:
   - Запустите `claude-desktop\Patch-Claude-Desktop.bat` (или `npm run patch:desktop`).
   - Если нужно подтянуть свежую версию из установленного пакета Microsoft Store (`WindowsApps\Claude_*`), запустите:
     ```cmd
     node claude-desktop/patch-desktop.js --sync
     ```
   - Запускайте приложение через ярлык **`Claude`** на Рабочем столе (ведёт на `%LOCALAPPDATA%\Programs\Claude-Patched\claude.exe`).

3. Для **Claude Science**:
   - Запустите `claude-science\Patch-Claude-Science.bat` (или `npm run patch:science`).
   - Запускайте приложение через ярлык **`Claude Science`** на Рабочем столе.

### Дополнительные параметры

Оба скрипта поддерживают переопределение адреса прокси:
```cmd
node claude-desktop/patch-desktop.js --proxy http://127.0.0.1:10809 --tz Europe/Berlin --lang en-US
node claude-science/patch-science.js --proxy http://127.0.0.1:10809
```
Также можно задать переменную окружения `CLAUDE_PROXY`.

---

## Почему защита не слетает после обновлений

1. **Windows Registry Group Policy (`HKCU\SOFTWARE\Policies\Claude`)**:
   Официальные корпоративные флаги Anthropic (`disableAutoUpdates`, `disableEssentialTelemetry`, `disableNonessentialTelemetry`, `disableNonessentialServices` = `1`) хранятся в реестре Windows и не затрагиваются при обновлении файлов приложения.
2. **Изолированная папка (`%LOCALAPPDATA%\Programs\Claude-Patched`)**:
   Microsoft Store обновляет только каталог `C:\Program Files\WindowsApps\Claude_*` и не имеет доступа к вашей пропатченной копии. При желании обновиться вы сами запускаете `patch-desktop.js --sync`.
3. **Нативный `config.toml` в Claude Science**:
   Демон `claude-science.exe` проверяет SHA-256 файлов оболочки `runtime\*\shell` по встроенному манифесту и распаковывает оригиналы при их изменении. Поэтому настройка прокси и запрет автообновлений выполнены через официальный `~/.claude-science/config.toml` (`[network] proxy`, `[update] auto_update = false`) и переменные окружения процесса в лаунчере `run-claude-science.vbs` — эти файлы не перезаписываются демоном.

---

## Проверка работы

- **Claude Desktop**: при первом входе через Google OAuth браузер перенаправляет на `claude://oauth/callback?...`, который привязан к `Claude-Patched\claude.exe`.
- **Claude Science**: в логах демона (`claude-science.com logs`) при старте должна присутствовать строка:
  `[proxy] proxy from environment — ... https via http://127.0.0.1:10809 (HTTPS_PROXY), http via http://127.0.0.1:10809 (HTTP_PROXY)`.
