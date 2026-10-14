# project garden — редактура и качество Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** привести project garden к ясному строчному голосу Тимофея и закрыть найденные UX, accessibility, import/export и GitHub Pages пробелы.

**Architecture:** сохранить vanilla-модули и разделение `garden-core.js` (чистые данные) / `app.js` (DOM и хранилище) / `plants.js` (SVG). UI получает состояние поиска и сортировки через `filterAndSortProjects`, экспорт использует один и тот же нормализованный набор проектов.

**Tech Stack:** HTML, CSS, browser JavaScript modules, IndexedDB, localStorage, Canvas 2D, Node built-in test runner, GitHub Actions Pages.

---

### Task 1: расширить доменную модель и тесты

**Files:**
- Modify: `garden-core.js`
- Modify: `tests/garden-core.test.mjs`

- [x] добавить безопасное форматирование даты/размера и покрыть регрессии для пустых и повреждённых значений;
- [x] сохранить лимиты JSON/ZIP и проверку traversal-путей;
- [x] добавить тесты, что поиск учитывает имя, описание, заметку, следующий шаг и файлы, а сортировка стабильна;
- [x] прогнать `node --test tests/*.test.mjs`.

### Task 2: подключить поиск, сортировку и ясные состояния

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

- [x] добавить поисковое поле с кнопкой очистки и select сортировки;
- [x] хранить `searchQuery` и `sortMode`, передавать их в `filterAndSortProjects`;
- [x] показать отдельное состояние для пустого сада и для нулевого результата фильтра/поиска;
- [x] при скрытии выбранного проекта вернуть инспектор в безопасное состояние;
- [x] добавить понятный текстический счётчик видимых проектов.

### Task 3: укрепить импорт, сохранение и экспорт

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `README.md`

- [x] сделать скачивание Blob совместимым с браузерами: временно добавить ссылку в DOM и удалить её после клика;
- [x] переписать PNG-экспорт на все проекты в несколько рядов, добавить обработку ошибки `toBlob`;
- [x] экспортировать нормализованный список и метаданные схемы;
- [x] оставить rollback при ошибке сохранения и показывать фактическую причину;
- [x] добавить в README ограничения и фактический сценарий ручного file picker.

### Task 4: привести голос, доступность и GitHub-обвязку

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `plants.js`
- Modify: `AGENT_PROMPT.md`
- Create: `404.html`
- Create: `.nojekyll`
- Create: `.github/workflows/pages.yml`

- [x] отредактировать все видимые русские строки в строчный регистр без изменения правильного регистра брендов и аббревиатур;
- [x] добавить skip-link, label для file input, `aria-pressed` и корректные live-region;
- [x] убрать дублирующее озвучивание SVG внутри подписанной кнопки;
- [x] обновить метаданные и заголовок страницы;
- [x] настроить Pages deployment из корня репозитория и понятную 404-страницу;
- [x] синхронизировать AGENT_PROMPT с фактическими функциями.

### Task 5: полная проверка

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-project-garden-copy-quality-design.md`
- Modify: `docs/superpowers/plans/2026-10-09-project-garden-copy-quality-plan.md`

- [x] выполнить `node --test tests/*.test.mjs`;
- [x] выполнить `node --check app.js`, `node --check garden-core.js`, `node --check plants.js`;
- [x] поднять `python3 -m http.server` и проверить загрузку, CRUD, фильтр, поиск, сортировку, пустые состояния, импорт/экспорт и narrow layout;
- [x] проверить отсутствие console errors и убедиться, что все пользовательские русские строки начинаются со строчной, если это не имя или аббревиатура.

