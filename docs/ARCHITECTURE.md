# Техническая архитектура патча

## 1. Claude Desktop (`claude-desktop/`)

### Поверхность утечек в оригинальном клиенте (Electron + MSIX)
1. **Electron Fuses**: оригинальный `claude.exe` собран с включёнными предохранителями `EnableEmbeddedAsarIntegrityValidation` и `OnlyLoadAppFromAsar`, из-за чего любая модификация `resources\app.asar` прерывает запуск с фатальной ошибкой целостности заголовка ASAR.
2. **Сетевые интерфейсы (`index.chunk-*.js`)**: бандл вызывает `os.networkInterfaces()`, собирая имена сетевых адаптеров (включая VPN/TUN-адаптеры), MAC-адреса и локальные IP.
3. **Идентификаторы устройства**: в HTTP-заголовки запросов добавляется `anthropic-device-id` / `ant-did` (управляется флагом `IKt`).
4. **WebRTC и часовой пояс**: без явных ключей Chromium STUN/TURN UDP-запросы могут обходить HTTP-прокси, а `Intl` / `navigator.language` передают системную таймзону и локаль.
5. **Телеметрия**: Sentry (`*.sentry.io`), Datadog RUM (`/api/v2/rum`, `*.datadoghq.com`) и Statsig.

### Реализованные уровни защиты
- **Снятие Electron Fuses** (`@electron/fuses`): перевод `EnableEmbeddedAsarIntegrityValidation` и `OnlyLoadAppFromAsar` в `false` (булево значение, т.к. числовые константы в API трактуются как truthy).
- **Патч `.vite/build/index.pre.js`**:
  - Инжект переключателей Chromium до инициализации `app`: `--proxy-server`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--disable-webrtc-hw-decoding`, `--timezone`, `--lang`.
  - Подключение внешнего `enhancements/loader.js`.
- **Патч `.vite/build/index.chunk-*.js`**:
  - Заглушка `s.networkInterfaces` → `() => ({})`.
  - Отключение прикрепления `device-id` (`IKt=!0` → `IKt=!1`).
- **Main-process Privacy Shield (`enhancements/loader.js`)**:
  - `session.defaultSession.webRequest.onBeforeRequest`: блокировка доменов `sentry.io`, `datadoghq.com`, `statsig.com`, `statsigapi.net`.
  - `session.defaultSession.webRequest.onBeforeSendHeaders`: удаление `anthropic-device-id`, `ant-did`, `x-datadog-*`, `sentry-trace`, `baggage`.
  - Обработчики `second-instance` и `browser-window-created` для гарантированного показа и фокуса окна при повторном клике по ярлыку.
- **Системные политики (`HKCU\SOFTWARE\Policies\Claude`)**:
  - `disableAutoUpdates = 1`
  - `disableEssentialTelemetry = 1`
  - `disableNonessentialTelemetry = 1`
  - `disableNonessentialServices = 1`

---

## 2. Claude Science (`claude-science/`)

### Архитектура приложения
Claude Science состоит из двух частей:
1. **Демон Operon (`%LOCALAPPDATA%\Programs\ClaudeScience\claude-science.exe`)**: локальный сервер на `127.0.0.1:8000` (и sandbox на `8001`), управляющий моделями, Python/Conda-окружениями и 24 встроенными научными MCP-серверами.
2. **Оболочка Electron 42.10.0 (`~/.claude-science/runtime/*/shell`)**: UI-окно поверх локального HTTP-сервера.

### Особенность целостности (Integrity Manifest)
Внутрь бинарного файла `claude-science.exe` вшит полный словарь SHA-256 хэшей для директории `runtime/<version>/shell/` (включая `shell-manifest.json`, `main.js`, `policy.js`, `updater.js`). При несовпадении хэша демон автоматически перераспаковывает оригинальные файлы оболочки.

### Безопасное решение без нарушения манифеста
1. **`~/.claude-science/config.toml`**:
   - `[network] proxy = "http://127.0.0.1:10809"` — нативная директива прокси для демона.
   - `[update] auto_update = false` — нативное отключение автообновлений (проверяется в `root-daemon-probe.js`).
   - `[conda] ssl_no_revoke = true` — корректная проверка TLS через прокси для `micromamba`.
2. **Изолированный лаунчер (`run-claude-science.vbs`)**:
   Выставляет `HTTP_PROXY`, `HTTPS_PROXY` и `NO_PROXY` исключительно в блоке окружения процесса (`WshShell.Environment("PROCESS")`) перед запуском `claude-science.exe`, не загрязняя глобальные переменные пользователя.
3. **Реестровые политики (`HKCU\SOFTWARE\Policies\Claude`)**: разделяются с Claude Desktop.
