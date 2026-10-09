# Project Garden — reliability and UX implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Strengthen the local project garden into a dependable, accessible static app with safe import/export, resilient persistence, clear filtering/search, and a restrained botanical interface.

**Architecture:** Keep the no-build vanilla module architecture. Move pure project normalization, validation, import limits, and formatting helpers into `garden-core.js`; keep DOM rendering and event wiring in `app.js`. IndexedDB remains the primary store with a versioned localStorage mirror and a single commit path, while ZIP parsing stays metadata-only.

**Tech Stack:** HTML, CSS, browser JavaScript modules, IndexedDB, localStorage fallback, Canvas 2D, Node’s built-in test runner.

---

### Task 1: Add pure domain and import helpers

**Files:**
- Create: `garden-core.js`
- Create: `tests/garden-core.test.mjs`

- [x] Write tests for deterministic normalization, unique IDs, date conversion, JSON limits, ZIP path validation, status counts, search, and sort.
- [x] Export `STATUS_LABELS`, `STATUS_SHORT`, `COLORS`, import limits, `uid`, `normalizeProject`, `normalizeFile`, `validDate`, `extensionOf`, `formatBytes`, `formatDate`, `relativeAge`, `parseProjectPayload`, `mergeProjects`, `filterAndSortProjects`, and `countByStatus`.
- [x] Ensure `parseProjectPayload` accepts an array or `{ projects }`, rejects non-objects, enforces 5 MB and 500-project limits, normalizes fields, and returns `{ projects, skipped }`.
- [x] Ensure `mergeProjects` de-duplicates IDs using a supplied existing set and returns collision/skipped counts without mutating inputs.
- [x] Keep all helpers browser-compatible and free of DOM access.

### Task 2: Replace persistence and ZIP handling with resilient flows

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `tests/garden-core.test.mjs`

- [x] Import domain helpers from `garden-core.js` and remove duplicate normalization/formatting implementations from `app.js`.
- [x] Add a versioned mirror envelope containing `schemaVersion`, `revision`, `savedAt`, and `projects`; use one `commitProjects` function that writes IndexedDB and mirror together and reports failures.
- [x] Handle IndexedDB open/read/write failures with a visible message and fall back to localStorage without unhandled rejections.
- [x] Guard saves/deletes/imports with rollback-safe `try/catch` and show the actual failure message.
- [x] Harden ZIP central-directory parsing with archive-size, entry-count, total-uncompressed-size, exact directory-boundary, path, and date checks; never decompress.
- [x] Add stable duplicate handling for JSON imports and ZIP entries; show imported/skipped counts.
- [x] Fix date input parsing so invalid values fall back to the current date instead of throwing.

### Task 3: Improve garden navigation and project workflows

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

- [x] Add a compact search field, clear action, and sort select in the garden heading; search name, description, note, and next step.
- [x] Add an explicit filtered-empty state with a clear-filter action; keep the inspector selection consistent when its plant is hidden.
- [x] Add a duplicate-project action in the inspector, preserving the same status/color and resetting the name to a clear draft.
- [x] Track and display the last successful save time instead of the current render time.
- [x] Add skip-link, accessible label for the file input, decorative legend semantics, and non-duplicated screen-reader labels for plant SVGs.
- [x] Respect reduced-motion for scroll behavior and keep keyboard Escape behavior predictable for unsaved drafts.

### Task 4: Make exports and visual states production-safe

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `README.md`

- [x] Export JSON only after the current in-memory list is normalized and include schema metadata.
- [x] Render PNG from the same sorted/filtered project list used by the scene, lay out all projects across rows, handle `toBlob` failures, and append the temporary download anchor before clicking.
- [x] Add loading, no-results, and import-error copy that stays concise and specific.
- [x] Preserve the existing palette and typography; refine spacing, focus, hover, responsive controls, and reduced-motion without gradients, glass cards, pills, KPI tiles, or decorative filler.
- [x] Update README with the new search/sort/duplicate behavior and import limits.

### Task 5: Verify all behavior

**Files:**
- Modify: `tests/plants.test.mjs` only if regression coverage needs an adjustment.

- [x] Run `node --test tests/*.test.mjs`.
- [x] Run `node --check app.js`, `node --check garden-core.js`, and `node --check plants.js`.
- [x] Serve the folder with `python3 -m http.server` and exercise initial load, add/save/delete, duplicate, search, sort, filters, invalid JSON, duplicate JSON IDs, ZIP metadata import, export, keyboard focus, 320px layout, and reduced-motion.
- [x] Confirm no console errors and no unhandled promise rejections; update docs if a browser limitation is found.

