import { plantSvg as botanicalPlantSvg } from './plants.js';
import {
  COLORS,
  MAX_JSON_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  MAX_ZIP_FILES,
  STATUS_LABELS,
  STATUS_SHORT,
  extensionOf,
  formatBytes,
  formatDate,
  mergeProjects,
  filterAndSortProjects,
  countByStatus,
  normalizeFile,
  normalizeProject,
  parseProjectPayload,
  relativeAge,
  uid,
  validDate,
} from './garden-core.js';

const DB_NAME = 'project-garden';
const DB_VERSION = 2;
const STORE_NAME = 'projects';
const META_STORE_NAME = 'meta';
const MIRROR_SCHEMA_VERSION = 2;

const refs = {
  add: document.querySelector('#add-project'),
  emptyAdd: document.querySelector('[data-action="empty-add"]'),
  scene: document.querySelector('#garden-scene'),
  layer: document.querySelector('#plants-layer'),
  empty: document.querySelector('#garden-empty'),
  emptyTitle: document.querySelector('#empty-title'),
  emptyCopy: document.querySelector('#empty-copy'),
  clearFilter: document.querySelector('#clear-filter'),
  count: document.querySelector('#project-count'),
  lastSync: document.querySelector('#last-sync'),
  form: document.querySelector('#project-form'),
  inspectorEmpty: document.querySelector('#inspector-empty'),
  panelIndex: document.querySelector('#panel-index'),
  preview: document.querySelector('#plant-preview'),
  statusMarker: document.querySelector('#status-marker'),
  statusCopy: document.querySelector('#status-copy'),
  statusAge: document.querySelector('#status-age'),
  id: document.querySelector('#project-id'),
  name: document.querySelector('#project-name'),
  description: document.querySelector('#project-description'),
  status: document.querySelector('#project-status'),
  color: document.querySelector('#project-color'),
  updated: document.querySelector('#project-updated'),
  note: document.querySelector('#project-note'),
  nextStep: document.querySelector('#project-next-step'),
  delete: document.querySelector('#delete-project'),
  importButton: document.querySelector('#import-button'),
  fileInput: document.querySelector('#file-input'),
  exportJson: document.querySelector('#export-json'),
  exportPng: document.querySelector('#export-png'),
  toast: document.querySelector('#toast'),
  fileNote: document.querySelector('#file-note'),
  filters: [...document.querySelectorAll('[data-filter]')],
  search: document.querySelector('#project-search'),
  clearSearch: document.querySelector('#clear-search'),
  sort: document.querySelector('#project-sort'),
  duplicate: document.querySelector('#duplicate-project'),
  filterCounts: {
    all: document.querySelector('#filter-count-all'),
    active: document.querySelector('#filter-count-active'),
    sleeping: document.querySelector('#filter-count-sleeping'),
    archived: document.querySelector('#filter-count-archived'),
  },
};

let db;
let projects = [];
let activeFilter = 'all';
let searchQuery = '';
let sortMode = 'updated';
let selectedId = null;
let toastTimer;
let isNewProject = false;
let lastSavedAt = null;
let revision = 0;
let storedMeta = null;
let commitQueue = Promise.resolve();

const DEMO_PROJECTS = [
  normalizeProject({ id: 'project-studio', name: 'сайт студии', description: 'новая полка для работ и ясного разговора с клиентами.', color: '#b7644a', status: 'active', updatedAt: daysAgo(2), note: 'собрать спокойный первый экран.', nextStep: 'проверить тексты с командой' }),
  normalizeProject({ id: 'journal', name: 'садовый журнал', description: 'личный архив наблюдений, заметок и маленьких сезонов.', color: '#718b6a', status: 'sleeping', updatedAt: daysAgo(29), note: 'не торопить рост.', nextStep: 'вернуться к структуре весной' }),
  normalizeProject({ id: 'library', name: 'тихая библиотека', description: 'подборка книг, к которым хочется возвращаться.', color: '#c89b4b', status: 'archived', updatedAt: daysAgo(118), note: 'сохранить как завершённый этюд.', nextStep: '' }),
];

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function normalizeProjectList(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    try {
      const project = normalizeProject(item);
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      result.push(project);
    } catch {
      // Ignore malformed records while restoring a local database.
    }
  }
  return result;
}

function mirrorRecord(value) {
  if (Array.isArray(value)) return { schemaVersion: 0, revision: 0, savedAt: null, projects: normalizeProjectList(value), legacy: true };
  if (!value || typeof value !== 'object' || !Array.isArray(value.projects)) return { schemaVersion: 0, revision: 0, savedAt: null, projects: [], legacy: false };
  const parsedRevision = Number(value.revision);
  const savedAt = validDate(value.savedAt) ? new Date(value.savedAt).toISOString() : null;
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    revision: Number.isFinite(parsedRevision) && parsedRevision >= 0 ? Math.floor(parsedRevision) : 0,
    savedAt,
    projects: normalizeProjectList(value.projects),
    legacy: !Number(value.schemaVersion) || Number(value.schemaVersion) < MIRROR_SCHEMA_VERSION,
  };
}

function readMirror() {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return mirrorRecord(null);
    return mirrorRecord(JSON.parse(storage.getItem(DB_NAME) || 'null'));
  } catch {
    return mirrorRecord(null);
  }
}

function writeMirror(items, nextRevision, savedAt) {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.setItem !== 'function') throw new Error('локальное хранилище недоступно.');
  const envelope = {
    schemaVersion: MIRROR_SCHEMA_VERSION,
    revision: nextRevision,
    savedAt,
    projects: normalizeProjectList(items),
  };
  storage.setItem(DB_NAME, JSON.stringify(envelope));
}

function openDatabase() {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb || typeof indexedDb.open !== 'function') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; callback(value); };
    let request;
    try { request = indexedDb.open(DB_NAME, DB_VERSION); } catch (error) { finish(reject, error); return; }
    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        if (!store.indexNames.contains('status')) store.createIndex('status', 'status');
        if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt');
        if (!database.objectStoreNames.contains(META_STORE_NAME)) database.createObjectStore(META_STORE_NAME, { keyPath: 'id' });
      } catch (error) { finish(reject, error); }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { try { database.close(); } catch { /* ignore */ } };
      finish(resolve, database);
    };
    request.onerror = () => finish(reject, request.error || new Error('не удалось открыть IndexedDB.'));
    request.onblocked = () => finish(reject, new Error('IndexedDB заблокирована другим окном.'));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    if (!request) { reject(new Error('операция IndexedDB недоступна.')); return; }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('ошибка IndexedDB.'));
  });
}

async function readProjects() {
  if (!db) { storedMeta = null; return readMirror().projects; }
  try {
    const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readonly');
    const [result, meta] = await Promise.all([
      idbRequest(transaction.objectStore(STORE_NAME).getAll()),
      idbRequest(transaction.objectStore(META_STORE_NAME).get('state')),
    ]);
    storedMeta = meta && typeof meta === 'object' ? meta : null;
    return normalizeProjectList(result);
  } catch (error) {
    throw error instanceof Error ? error : new Error('не удалось прочитать IndexedDB.');
  }
}

async function persistAll(items, nextRevision = revision + 1, savedAt = new Date().toISOString()) {
  if (!db) return false;
  const normalized = normalizeProjectList(items);
  const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
  normalized.forEach((item) => store.put(item));
  transaction.objectStore(META_STORE_NAME).put({ id: 'state', schemaVersion: MIRROR_SCHEMA_VERSION, revision: nextRevision, savedAt });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('не удалось записать IndexedDB.'));
    transaction.onabort = () => reject(transaction.error || new Error('запись IndexedDB прервана.'));
  });
  return true;
}

function commitProjects(items) {
  const normalized = normalizeProjectList(items);
  const commit = commitQueue.then(async () => {
    const nextRevision = Math.max(revision, Number(storedMeta?.revision) || 0) + 1;
    const savedAt = new Date().toISOString();
    let idbError = null;
    if (db) {
      try {
        await persistAll(normalized, nextRevision, savedAt);
      } catch (error) {
        idbError = error;
        try { db.close?.(); } catch { /* ignore */ }
        db = null;
      }
    }
    try {
      writeMirror(normalized, nextRevision, savedAt);
    } catch (mirrorError) {
      if (idbError) {
        throw new Error(`не удалось сохранить данные: ${mirrorError?.message || 'локальное хранилище недоступно.'}`);
      }
      throw new Error(`данные записаны в IndexedDB, но зеркало недоступно: ${mirrorError?.message || 'ошибка локального хранилища.'}`);
    }
    projects = normalized;
    revision = nextRevision;
    lastSavedAt = savedAt;
    return { projects: normalized, revision, savedAt, fallback: Boolean(idbError), idbError };
  });
  commitQueue = commit.catch(() => {});
  return commit;
}

function projectTimestamp(items) {
  return (Array.isArray(items) ? items : []).reduce((latest, item) => {
    if (!validDate(item?.updatedAt)) return latest;
    return Math.max(latest, new Date(item.updatedAt).getTime());
  }, -Infinity);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableProjectsJson(items) {
  const normalized = normalizeProjectList(items).slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify(stableValue(normalized));
}

function chooseStoredProjects(stored, mirror) {
  const storedItems = normalizeProjectList(stored);
  const mirrorItems = normalizeProjectList(mirror.projects);
  if (!storedItems.length && !mirrorItems.length) return { projects: [], source: 'none' };
  if (!storedItems.length) return { projects: mirrorItems, source: 'mirror' };
  if (!mirrorItems.length) return { projects: storedItems, source: 'stored' };
  const storedRevision = Number.isFinite(Number(storedMeta?.revision)) ? Number(storedMeta.revision) : 0;
  const mirrorRevision = Number.isFinite(Number(mirror.revision)) ? Number(mirror.revision) : 0;
  if (storedRevision !== mirrorRevision) return storedRevision > mirrorRevision ? { projects: storedItems, source: 'stored' } : { projects: mirrorItems, source: 'mirror' };
  const storedSavedAt = validDate(storedMeta?.savedAt) ? new Date(storedMeta.savedAt).getTime() : -Infinity;
  const mirrorSavedAt = validDate(mirror.savedAt) ? new Date(mirror.savedAt).getTime() : -Infinity;
  if (storedSavedAt !== mirrorSavedAt) return storedSavedAt > mirrorSavedAt ? { projects: storedItems, source: 'stored' } : { projects: mirrorItems, source: 'mirror' };
  if (stableProjectsJson(storedItems) === stableProjectsJson(mirrorItems)) return { projects: mirrorItems, source: 'mirror' };
  const storedTime = projectTimestamp(storedItems);
  const mirrorTime = projectTimestamp(mirrorItems);
  if (storedTime > mirrorTime) return { projects: storedItems, source: 'stored' };
  if (mirrorTime > storedTime) return { projects: mirrorItems, source: 'mirror' };
  return storedMeta ? { projects: storedItems, source: 'stored' } : { projects: mirrorItems, source: 'mirror' };
}

function ageInDays(project) {
  if (!validDate(project?.updatedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(project.updatedAt).getTime()) / 86400000));
}

function toInputDate(dateValue) {
  const date = validDate(dateValue) ? new Date(dateValue) : new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function fromInputDate(value) {
  if (!value) return new Date().toISOString();
  const candidate = new Date(`${value}T12:00:00`);
  return validDate(candidate) ? candidate.toISOString() : new Date().toISOString();
}


function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

function render() {
  const visible = filterAndSortProjects(projects, { filter: activeFilter, query: searchQuery, sort: sortMode });
  refs.layer.replaceChildren();
  refs.empty.hidden = visible.length > 0;
  refs.layer.hidden = visible.length === 0;
  const isFiltered = activeFilter !== 'all' || Boolean(searchQuery.trim());
  if (refs.emptyTitle) refs.emptyTitle.textContent = isFiltered ? 'в этом срезе пусто' : 'посадите первый проект';
  if (refs.emptyCopy) refs.emptyCopy.textContent = isFiltered ? 'снимите фильтр или измените запрос — остальные растения останутся на месте.' : 'добавьте растение вручную или импортируйте JSON. сад сохранится в этом браузере.';
  if (refs.clearFilter) refs.clearFilter.hidden = !isFiltered;
  if (refs.clearSearch) refs.clearSearch.hidden = !searchQuery;
  if (refs.search && refs.search.value !== searchQuery) refs.search.value = searchQuery;
  if (refs.sort && refs.sort.value !== sortMode) refs.sort.value = sortMode;
  if (selectedId && !visible.some((project) => project.id === selectedId)) {
    if (isNewProject) {
      projects = projects.filter((project) => project.id !== selectedId);
      selectedId = null;
      isNewProject = false;
      render();
      return;
    }
    selectedId = null;
    isNewProject = false;
  }
  visible.forEach((project) => {
    const button = document.createElement('button');
    button.className = `plant-button${selectedId === project.id ? ' is-selected' : ''}`;
    button.type = 'button';
    button.dataset.id = project.id;
    button.setAttribute('aria-label', `${project.name}, ${STATUS_LABELS[project.status]}, обновлено ${formatDate(project.updatedAt)}`);
    button.innerHTML = `<span class="plant-figure">${botanicalPlantSvg(project)}<span class="plant-label">${escapeHtml(project.name)}</span><span class="plant-state">${escapeHtml(STATUS_SHORT[project.status])}</span><span class="plant-age">${escapeHtml(formatDate(project.updatedAt))} · ${escapeHtml(relativeAge(project))}</span></span>`;
    const sceneSvg = button.querySelector('svg');
    if (sceneSvg) { sceneSvg.setAttribute('aria-hidden', 'true'); sceneSvg.removeAttribute('role'); sceneSvg.removeAttribute('aria-label'); sceneSvg.querySelector('title')?.remove(); }
    button.addEventListener('click', () => selectProject(project.id, button));
    refs.layer.append(button);
  });
  refs.count.textContent = isFiltered
    ? `${visible.length} из ${projects.length} ${pluralize(projects.length, 'растение', 'растения', 'растений')}`
    : `${projects.length} ${pluralize(projects.length, 'растение', 'растения', 'растений')}`;
  refs.lastSync.textContent = lastSavedAt ? `сохранено ${formatDate(lastSavedAt)}` : 'локально';
  const counts = countByStatus(projects);
  refs.filterCounts.all.textContent = String(counts.all);
  refs.filterCounts.active.textContent = String(counts.active);
  refs.filterCounts.sleeping.textContent = String(counts.sleeping);
  refs.filterCounts.archived.textContent = String(counts.archived);
  refs.filters.forEach((filter) => filter.classList.toggle('is-active', filter.dataset.filter === activeFilter));
  refs.filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter.dataset.filter === activeFilter)));
  renderInspector();
}

function pluralize(value, one, few, many) {
  const mod = value % 100;
  if (mod >= 11 && mod <= 14) return many;
  switch (value % 10) { case 1: return one; case 2: case 3: case 4: return few; default: return many; }
}

function selectProject(id, trigger) {
  if (isNewProject && selectedId && selectedId !== id) projects = projects.filter((item) => item.id !== selectedId);
  selectedId = id;
  isNewProject = false;
  render();
  refs.name.focus({ preventScroll: true });
  if (trigger) trigger.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function renderInspector() {
  const project = projects.find((item) => item.id === selectedId);
  if (!project) {
    refs.form.hidden = true;
    refs.inspectorEmpty.hidden = false;
    refs.panelIndex.textContent = '';
    return;
  }
  refs.form.hidden = false;
  refs.inspectorEmpty.hidden = true;
  refs.panelIndex.textContent = '';
  refs.id.value = project.id;
  refs.name.value = project.name;
  refs.description.value = project.description;
  refs.status.value = project.status;
  refs.color.value = project.color;
  refs.updated.value = toInputDate(project.updatedAt);
  refs.note.value = project.note;
  refs.nextStep.value = project.nextStep;
  refs.preview.innerHTML = botanicalPlantSvg(project, true);
  refs.statusCopy.textContent = STATUS_SHORT[project.status];
  refs.statusAge.textContent = `${formatDate(project.updatedAt)} · ${relativeAge(project)}`;
  refs.statusMarker.style.color = project.status === 'sleeping' ? 'var(--ochre)' : project.status === 'archived' ? 'var(--terracotta)' : 'var(--moss)';
  refs.statusMarker.style.background = project.status === 'sleeping' ? 'transparent' : 'currentColor';
}

function openNewProject() {
  if (isNewProject && selectedId) {
    projects = projects.filter((item) => item.id !== selectedId);
  }
  const project = normalizeProject({ name: '', description: '', color: COLORS[projects.length % COLORS.length], status: 'active', updatedAt: new Date().toISOString(), note: '', nextStep: '' });
  project.name = '';
  project.createdAt = new Date().toISOString();
  projects.push(project);
  selectedId = project.id;
  isNewProject = true;
  render();
  refs.name.focus();
  refs.name.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function duplicateSelected() {
  const source = projects.find((item) => item.id === selectedId);
  if (!source) return;
  if (isNewProject && selectedId) projects = projects.filter((item) => item.id !== selectedId);
  const duplicate = normalizeProject({ ...source, id: uid(), name: `${source.name} — копия`.slice(0, 60), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  projects.push(duplicate);
  selectedId = duplicate.id;
  isNewProject = true;
  render();
  refs.name.focus();
  showToast('копия создана. сохраните паспорт, когда будете готовы.');
}

async function saveForm(event) {
  event.preventDefault();
  const previousProjects = projects;
  const previousSelectedId = selectedId;
  const previousIsNew = isNewProject;
  const project = projects.find((item) => item.id === refs.id.value);
  const name = refs.name.value.trim();
  if (!name) {
    refs.name.focus();
    showToast('введите название растения.');
    return;
  }
  const payload = normalizeProject({
    ...(project || {}),
    name,
    description: refs.description.value,
    status: refs.status.value,
    color: refs.color.value,
    note: refs.note.value,
    nextStep: refs.nextStep.value,
    updatedAt: fromInputDate(refs.updated.value),
    createdAt: project?.createdAt || new Date().toISOString(),
  }, refs.id.value);
  const nextProjects = projects.map((item) => item.id === payload.id ? payload : item);
  try {
    const result = await commitProjects(nextProjects);
    isNewProject = false;
    showToast(result.fallback ? 'паспорт сохранён в локальном хранилище.' : 'паспорт сохранён локально.');
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(`не удалось сохранить: ${error?.message || 'ошибка хранилища.'}`);
    render();
  }
}

async function deleteSelected() {
  const project = projects.find((item) => item.id === selectedId);
  if (!project) return;
  if (!window.confirm(`удалить растение «${project.name || 'без названия'}»?`)) return;
  const previousProjects = projects;
  const previousSelectedId = selectedId;
  const previousIsNew = isNewProject;
  try {
    const result = await commitProjects(projects.filter((item) => item.id !== project.id));
    selectedId = null;
    isNewProject = false;
    showToast(result.fallback ? 'растение убрано и сохранено локально.' : 'растение убрано из сада.');
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(`не удалось сохранить: ${error?.message || 'ошибка хранилища.'}`);
    render();
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => refs.toast.classList.remove('is-visible'), 3600);
}

async function importFile(file) {
  if (!file) return;
  const previousProjects = projects;
  const previousSelectedId = selectedId;
  const previousIsNew = isNewProject;
  refs.fileNote.textContent = `${file.name} · ${(Number(file.size) / 1024).toFixed(1)} КБ`;
  try {
    if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
      const fileSize = Number(file.size);
      if (Number.isFinite(fileSize) && fileSize > MAX_JSON_BYTES) throw new Error('JSON больше 5 МБ. выберите файл поменьше.');
      const source = typeof file.slice === 'function' ? file.slice(0, MAX_JSON_BYTES + 1) : file;
      const text = await source.text();
      let textBytes;
      try { textBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : text.length; } catch { textBytes = text.length; }
      if (textBytes > MAX_JSON_BYTES) throw new Error('JSON слишком большой.');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('JSON повреждён или имеет неверный формат.'); }
      const parsed = parseProjectPayload(data, { byteLength: Number.isFinite(fileSize) ? fileSize : textBytes });
      if (!parsed.projects.length) throw new Error('в JSON нет подходящих проектов.');
      const merged = mergeProjects(projects, parsed.projects);
      const result = await commitProjects(merged.projects);
      selectedId = merged.importedIds?.[0] || merged.projects[0]?.id || null;
      isNewProject = false;
      const skipped = parsed.skipped + merged.skipped;
      const suffix = `импортировано растений: ${merged.imported}; пропущено: ${skipped}; совпадений: ${merged.collisions}.`;
      showToast(result.fallback ? `${suffix} сохранено локально.` : suffix);
    } else if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      const fileSize = Number(file.size);
      if (fileSize > MAX_ZIP_BYTES) throw new Error('ZIP больше 100 МБ. выберите архив поменьше.');
      const metadata = await readZipMetadata(await file.arrayBuffer(), file.name);
      const project = normalizeProject({
        id: uid(),
        name: metadata.name,
        description: `архив · ${metadata.files.length} файлов · ${formatBytes(metadata.totalBytes)}`,
        color: COLORS[projects.length % COLORS.length],
        status: 'active',
        updatedAt: metadata.updatedAt,
        files: metadata.files,
        source: 'zip',
        nextStep: 'открыть список следов и выбрать продолжение',
      });
      const merged = mergeProjects(projects, [project]);
      const result = await commitProjects(merged.projects);
      selectedId = merged.importedIds?.[0] || project.id;
      isNewProject = false;
      const suffix = `ZIP прочитан безопасно: ${metadata.files.length} записей; пропущено: ${metadata.truncated}.`;
      showToast(result.fallback ? `${suffix} сохранено локально.` : suffix);
    } else {
      throw new Error('поддерживаются только JSON и ZIP.');
    }
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(error?.message || 'не удалось прочитать файл.');
    render();
  } finally {
    refs.fileInput.value = '';
  }
}

function readZipMetadata(arrayBuffer, filename) {
  if (!arrayBuffer || !Number.isFinite(arrayBuffer.byteLength) || arrayBuffer.byteLength > MAX_ZIP_BYTES) throw new Error('ZIP больше 100 МБ. выберите архив поменьше.');
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 22) throw new Error('не найден каталог ZIP. архив повреждён или использует ZIP64.');
  const view = new DataView(arrayBuffer);
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('не найден каталог ZIP. архив повреждён или использует ZIP64.');
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength > bytes.length) throw new Error('комментарий ZIP выходит за границы архива.');
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const directoryEnd = directoryOffset + directorySize;
  if (entries > MAX_ZIP_ENTRIES || directoryOffset > bytes.length || directoryEnd > bytes.length || directoryEnd > eocd) throw new Error('ZIP содержит слишком много или повреждённых записей.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = [];
  const names = new Set();
  let truncated = 0;
  let totalBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('каталог ZIP повреждён.');
    const centralCursor = cursor;
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('ZIP64-архивы не поддерживаются.');
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error('распакованный размер ZIP больше 500 МБ.');
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLength + extraLength + commentLen;
    if (nextCursor > directoryEnd || nextCursor > eocd) throw new Error('имя записи ZIP выходит за границы каталога.');
    let name;
    try { name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength)); } catch { throw new Error('имя записи ZIP имеет неверную кодировку.'); }
    // Verify each local record stays before the central directory; no payload is decompressed.
    const localOffset = view.getUint32(centralCursor + 42, true);
    if (localOffset + 30 > directoryOffset || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('локальная запись ZIP повреждена.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localDataEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    if (localDataEnd > directoryOffset || localDataEnd > bytes.length) throw new Error('данные записи ZIP выходят за границы архива.');
    cursor = nextCursor;
    const modifiedAt = dosDateTimeToIso(view.getUint16(centralCursor + 14, true), view.getUint16(centralCursor + 12, true));
    const normalized = normalizeFile({ name, extension: extensionOf(name), size: uncompressedSize, modifiedAt });
    if (!normalized || names.has(normalized.name)) { truncated += 1; continue; }
    names.add(normalized.name);
    if (files.length >= MAX_ZIP_FILES) { truncated += 1; continue; }
    files.push(normalized);
  }
  if (cursor !== directoryEnd) throw new Error('границы каталога ZIP не совпадают.');
  const newest = files.map((file) => file.modifiedAt).filter(Boolean).sort().pop();
  return { name: String(filename || 'архив').replace(/\.zip$/i, ''), files, totalBytes, truncated, updatedAt: newest || new Date().toISOString() };
}

function dosDateTimeToIso(date, time) {
  const year = 1980 + ((date >> 9) & 0x7f);
  const monthNumber = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  if (monthNumber < 1 || monthNumber > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const value = new Date(year, monthNumber - 1, day, hour, minute, second);
  if (!validDate(value) || value.getFullYear() !== year || value.getMonth() !== monthNumber - 1 || value.getDate() !== day) return null;
  return value.toISOString();
}

function downloadBlob(blob, filename) {
  if (!blob) throw new Error('не удалось подготовить файл для скачивания.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1000);
}

function exportJson() {
  try {
    const payload = { schemaVersion: MIRROR_SCHEMA_VERSION, exportedAt: new Date().toISOString(), revision, projects: normalizeProjectList(projects) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `project-garden-${new Date().toISOString().slice(0, 10)}.json`);
    showToast('JSON сохранён в загрузки.');
  } catch (error) {
    showToast(`не удалось сохранить JSON: ${error?.message || 'ошибка скачивания.'}`);
  }
}

function exportPng() {
  const sorted = filterAndSortProjects(projects, { filter: activeFilter, query: searchQuery, sort: sortMode });
  const canvas = document.createElement('canvas');
  const columns = Math.min(5, Math.max(1, sorted.length));
  const rows = Math.max(1, Math.ceil(sorted.length / columns));
  canvas.width = 1400; canvas.height = 260 + rows * 250;
  const ctx = canvas.getContext('2d');
  if (!ctx) { showToast('не удалось подготовить PNG в этом браузере.'); return; }
  ctx.fillStyle = '#f5f0e6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d9d3c6'; ctx.lineWidth = 1; ctx.strokeRect(48, 48, canvas.width - 96, canvas.height - 96);
  ctx.fillStyle = '#2f322c'; ctx.font = '600 54px Georgia'; ctx.fillText('сад проектов', 90, 140);
  ctx.fillStyle = '#73766c'; ctx.font = '14px monospace'; ctx.fillText(`${sorted.length} растений · ${new Date().toLocaleDateString('ru-RU')}`, 94, 176);
  const cellWidth = 1220 / columns;
  sorted.forEach((project, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const ground = 235 + row * 250;
    if (column === 0) {
      ctx.strokeStyle = '#445344'; ctx.beginPath(); ctx.moveTo(90, ground + 20); ctx.lineTo(1310, ground + 20); ctx.stroke();
      ctx.fillStyle = '#d8c5aa'; ctx.fillRect(90, ground + 22, 1220, 120);
    }
    drawCanvasPlant(ctx, project, 90 + cellWidth * (column + 0.5), ground);
  });
  canvas.toBlob((blob) => {
    if (!blob) { showToast('не удалось подготовить PNG в этом браузере.'); return; }
    try {
      downloadBlob(blob, `project-garden-${new Date().toISOString().slice(0, 10)}.png`);
      showToast('снимок PNG сохранён.');
    } catch (error) {
      showToast(`не удалось сохранить PNG: ${error?.message || 'ошибка скачивания.'}`);
    }
  }, 'image/png');
}

function drawCanvasPlant(ctx, project, x, ground) {
  const color = project.color;
  ctx.save(); ctx.translate(x, ground);
  ctx.strokeStyle = '#2f322c'; ctx.lineWidth = 3; ctx.beginPath();
  if (project.status === 'sleeping') { ctx.moveTo(0, 0); ctx.quadraticCurveTo(-7, -80, -36, -130); }
  else { ctx.moveTo(0, 0); ctx.lineTo(project.status === 'archived' ? 8 : 0, -150); }
  ctx.stroke();
  const leaf = (lx, ly, rot, opacity = 1) => { ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot); ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.strokeStyle = '#2f322c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 20, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); };
  if (project.status === 'archived') { leaf(-9, -90, -0.5, 0.35); leaf(11, -120, 0.5, 0.25); leaf(7, -150, 0, 0.3); }
  else { leaf(-18, -68, -0.4, project.status === 'sleeping' ? 0.55 : 0.95); leaf(18, -95, 0.45, project.status === 'sleeping' ? 0.5 : 0.95); leaf(-17, -122, -0.5, project.status === 'sleeping' ? 0.4 : 0.85); leaf(12, -148, 0.45, 0.85); }
  ctx.restore();
  ctx.fillStyle = '#2f322c'; ctx.font = '600 15px Georgia'; ctx.textAlign = 'center'; ctx.fillText(project.name.slice(0, 20), x, ground + 40); ctx.fillStyle = '#73766c'; ctx.font = '11px monospace'; ctx.fillText(STATUS_SHORT[project.status], x, ground + 58);
}

function bindEvents() {
  refs.add.addEventListener('click', openNewProject);
  refs.emptyAdd.addEventListener('click', openNewProject);
  refs.clearFilter?.addEventListener('click', () => { activeFilter = 'all'; searchQuery = ''; render(); refs.search?.focus(); });
  refs.form.addEventListener('submit', saveForm);
  refs.delete.addEventListener('click', deleteSelected);
  refs.duplicate?.addEventListener('click', duplicateSelected);
  refs.importButton.addEventListener('click', () => refs.fileInput.click());
  refs.fileInput.addEventListener('change', (event) => importFile(event.target.files?.[0]));
  refs.exportJson.addEventListener('click', exportJson);
  refs.exportPng.addEventListener('click', exportPng);
  refs.filters.forEach((filter) => filter.addEventListener('click', () => { activeFilter = filter.dataset.filter; render(); }));
  refs.search?.addEventListener('input', (event) => { searchQuery = event.target.value; render(); });
  refs.clearSearch?.addEventListener('click', () => { searchQuery = ''; if (refs.search) refs.search.value = ''; render(); refs.search?.focus(); });
  refs.sort?.addEventListener('change', (event) => { sortMode = event.target.value; render(); });
  refs.clearFilter?.addEventListener('click', () => { activeFilter = 'all'; searchQuery = ''; if (refs.search) refs.search.value = ''; render(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedId) {
      if (isNewProject) projects = projects.filter((item) => item.id !== selectedId);
      selectedId = null;
      isNewProject = false;
      render();
      refs.add.focus();
    }
  });
}

async function init() {
  bindEvents();
  try { db = await openDatabase(); } catch { db = null; showToast('IndexedDB недоступна — временно использую локальное хранилище.'); }
  let stored = [];
  try { stored = await readProjects(); } catch { db = null; showToast('не удалось прочитать IndexedDB — использую локальное зеркало.'); }
  const mirror = readMirror();
  const chosen = chooseStoredProjects(stored, mirror);
  if (chosen.source === 'none') {
    try {
      await commitProjects(DEMO_PROJECTS);
    } catch (error) {
      projects = normalizeProjectList(DEMO_PROJECTS);
      showToast(`не удалось сохранить демо-данные: ${error?.message || 'ошибка хранилища.'}`);
    }
  } else {
    projects = chosen.projects;
    revision = chosen.source === 'stored' ? Number(storedMeta?.revision) || 0 : mirror.revision;
    lastSavedAt = chosen.source === 'stored' ? storedMeta?.savedAt || null : mirror.savedAt;
    const needsMigration = mirror.legacy || chosen.source === 'stored' || !mirror.savedAt;
    if (needsMigration) {
      try { await commitProjects(projects); } catch (error) { showToast(`не удалось обновить хранилище: ${error?.message || 'ошибка.'}`); }
    }
  }
  render();
}

init();
