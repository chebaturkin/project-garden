# project garden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a static GitHub Pages-ready visual project garden with local persistence, manual creation, JSON/ZIP import, JSON/PNG export, and accessible responsive UI.

**Architecture:** A semantic HTML shell is styled with CSS variables and botanical SVG silhouettes. A single browser module handles state, IndexedDB persistence, safe ZIP central-directory parsing, import/export, filtering, and inspector updates. No backend or external API is required.

**Tech Stack:** HTML, CSS, vanilla JavaScript, IndexedDB, Canvas 2D, browser File APIs.

---

### Task 1: Create the static shell and design tokens

**Files:** `index.html`, `styles.css`

- [x] Add the page landmarks, filter controls, garden region, inspector form, import/export actions, live-region, and empty state.
- [x] Define the Fraunces/Azeret Mono typography pairing, palette, focus states, responsive layout, and reduced-motion rules.

### Task 2: Implement local project state and CRUD

**Files:** `app.js`

- [x] Add the project model, sample seed projects, IndexedDB open/read/write/delete helpers, and manual form validation.
- [x] Render plant silhouettes and textual state labels from status and project age.

### Task 3: Implement import/export and snapshot workflows

**Files:** `app.js`

- [x] Parse JSON arrays/objects with clear validation.
- [x] Parse ZIP central directory metadata only, with size/name/date limits and no decompression.
- [x] Add JSON download, PNG canvas snapshot, and file input fallback paths.

### Task 4: Verify behavior and responsive presentation

**Files:** `app.js`, `styles.css`

- [x] Exercise the page through a local server, verify no console errors, keyboard focus, reduced motion, empty state, and import errors.
- [x] Check narrow-screen layout and ensure IndexedDB data survives reload.
