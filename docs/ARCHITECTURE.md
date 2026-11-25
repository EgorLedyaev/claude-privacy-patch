# Техническая архитектура патча

## 1. Claude Desktop (`claude-desktop/`)

### Векторы утечек и их закрытие
1. **Electron Fuses**: оригинальный `claude.exe` проверяет целостность ASAR (`EnableEmbeddedAsarIntegrityValidation`). Патчер отключает `EnableEmbeddedAsarIntegrityValidation` и `OnlyLoadAppFromAsar` через `@electron/fuses`.
2. **Сетевые интерфейсы (`os.networkInterfaces`)**: закрыто на двух уровнях — рантайм-переопределение в `loader.js` до старта бандла + версионно-независимый патч в `index.chunk-*.js`.
3. **Идентификаторы устройства (`anthropic-device-id`, `ant-did`, `anthropic-anonymous-id`)**:
   - Отключается флаг инициализации device-id по паттерну вокруг `"00000000-0000-0000-0000-000000000000"` в `index.chunk-*.js` (не зависит от минифицированного имени переменной);
   - Дополнительно вырезается на сетевом уровне через `webRequest.onBeforeSendHeaders`.
4. **Все Electron-сессии (`defaultSession` + `session.fromPartition`)**:
   Claude Desktop создаёт изолированные сессии (например, для MCP/Cowork). `loader.js` подписывается на `app.on('session-created')` и применяет `setProxy`, блокировку телеметрии и очистку заголовков к **каждой** сессии.
5. **Язык и таймзона**: помимо флагов `--timezone` и `--lang`, `loader.js` переопределяет `app.getPreferredSystemLanguages()`, `app.getLocale()` и `app.getSystemLocale()`, чтобы `ru-RU` не утекало из настроек Windows.
6. **Node.js-окружение**: `loader.js` выставляет `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` для дочерних процессов (MCP-серверы, SDK).
7. **Восстановление окна**: обработчики `second-instance` и `browser-window-created` гарантируют показ и фокус окна при клике по ярлыку.
8. **Системные политики (`HKCU\SOFTWARE\Policies\Claude`)**: `disableAutoUpdates=1`, `disableEssentialTelemetry=1`, `disableNonessentialTelemetry=1`, `disableNonessentialServices=1`.

---

## 2. Claude Science (`claude-science/`)

### Архитектура и проверка целостности
`claude-science.exe` (демон Operon на `127.0.0.1:8000`) хранит внутри бинарника SHA-256 хэши файлов `runtime/<version>/shell/`. Любая прямая правка `shell/main.js` или `shell/policy.js` приводит к перераспаковке оригиналов при следующем запуске.

### Решение без нарушения манифеста
1. **`~/.claude-science/config.toml`**:
   - `[network] proxy = "http://127.0.0.1:10809"` — нативная директива прокси для демона;
   - `[update] auto_update = false` — нативное отключение автообновлений;
   - `[conda] ssl_no_revoke = true` — корректная работа TLS для `micromamba` через прокси.
2. **Процессный лаунчер (`run-claude-science.vbs`)**:
   Задаёт `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` только в окружении процесса перед запуском `claude-science.exe`.
3. **Реестровые политики (`HKCU\SOFTWARE\Policies\Claude`)**: разделяются с Claude Desktop.
