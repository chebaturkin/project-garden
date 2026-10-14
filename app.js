import { dictionaries, t, getLocale, localeTag, mountLocale, translateMessage, setLocale } from './i18n.js';
import { plantSvg as botanicalPlantSvg, growthProfile, transitionGrowth } from './plants.js';
import { gardenPng } from './garden-export.js';
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
  sceneDate: document.querySelector('#scene-date'),
  motionToggle: document.querySelector('#motion-toggle'),
  emptySpecimen: document.querySelector('#empty-specimen'),
  species: document.querySelector('#plant-species'),
  growthStage: document.querySelector('#growth-stage'),
  growthFill: document.querySelector('#growth-fill'),
  growthDays: document.querySelector('#growth-days'),
  previewGrowth: document.querySelector('#preview-growth'),
  growthDialog: document.querySelector('#growth-dialog'),
  closeGrowth: document.querySelector('#close-growth'),
  growthSlider: document.querySelector('#growth-slider'),
  growthSpecimen: document.querySelector('#growth-specimen'),
  growthProjectName: document.querySelector('#growth-project-name'),
  growthPreviewStage: document.querySelector('#growth-preview-stage'),
  growthPreviewDays: document.querySelector('#growth-preview-days'),
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
let inspectorKey = '';
let growthPreviewProject = null;
let motionEnabled = true;
let freshDemoGarden = false;
const plantObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  entries.forEach(({ target, isIntersecting }) => target.classList.toggle('is-in-view', isIntersecting));
}, { rootMargin: '40px' }) : null;

const DEMO_PROJECTS = [
  normalizeProject({ id: 'project-studio', get name() { return t("s0"); }, get description() { return t("s1"); }, color: '#718b6a', status: 'active', createdAt: daysAgo(58), updatedAt: daysAgo(2), get note() { return t("s2"); }, get nextStep() { return t("s3"); } }),
  normalizeProject({ id: 'field-notes', get name() { return t("s4"); }, get description() { return t("s5"); }, color: '#8c9d74', status: 'active', createdAt: daysAgo(24), updatedAt: daysAgo(4), get note() { return t("s6"); }, get nextStep() { return t("s7"); } }),
  normalizeProject({ id: 'bloom', get name() { return t("s8"); }, get description() { return t("s9"); }, color: '#b7644a', status: 'active', createdAt: daysAgo(9), updatedAt: daysAgo(6), get note() { return t("s10"); }, get nextStep() { return t("s11"); } }),
  normalizeProject({ id: 'journal', get name() { return t("s12"); }, get description() { return t("s13"); }, color: '#718b6a', status: 'sleeping', createdAt: daysAgo(52), updatedAt: daysAgo(29), get note() { return t("s14"); }, get nextStep() { return t("s15"); } }),
  normalizeProject({ id: 'library', get name() { return t("s16"); }, get description() { return t("s17"); }, color: '#c89b4b', status: 'archived', createdAt: daysAgo(180), updatedAt: daysAgo(118), get note() { return t("s18"); }, nextStep: '' }),
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
  if (!storage || typeof storage.setItem !== 'function') throw new Error(t("s19"));
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
    request.onerror = () => finish(reject, request.error || new Error(t("s20")));
    request.onblocked = () => finish(reject, new Error(t("s21")));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    if (!request) { reject(new Error(t("s22"))); return; }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(t("s23")));
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
    throw error instanceof Error ? error : new Error(t("s24"));
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
    transaction.onerror = () => reject(transaction.error || new Error(t("s25")));
    transaction.onabort = () => reject(transaction.error || new Error(t("s26")));
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
        throw new Error(t("s27", { p0: mirrorError?.message || t("s19") }));
      }
      throw new Error(t("s28", { p0: mirrorError?.message || t("s29") }));
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
  if (!storedItems.length && !mirrorItems.length) return { projects: [], source: storedMeta || mirror.savedAt ? 'mirror' : 'none' };
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
  const existing = new Map([...refs.layer.children].map((button) => [button.dataset.id, button]));
  refs.empty.hidden = visible.length > 0;
  refs.layer.hidden = visible.length === 0;
  const isFiltered = activeFilter !== 'all' || Boolean(searchQuery.trim());
  if (refs.emptyTitle) refs.emptyTitle.textContent = isFiltered ? t("s30") : t("s31");
  if (refs.emptyCopy) refs.emptyCopy.textContent = isFiltered ? t("s32") : t("s33");
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
  const now = Date.now();
  visible.forEach((project, index) => {
    let button = existing.get(project.id);
    if (!button) {
      button = document.createElement('button');
      button.className = 'plant-button is-entering';
      button.type = 'button';
      button.dataset.id = project.id;
      button.style.setProperty('--wind-duration', `${6 + (index % 5) * 1.3}s`);
      button.style.setProperty('--wind-delay', `${-index * 1.7}s`);
      button.addEventListener('click', () => selectProject(project.id));
      button.addEventListener('animationend', (event) => { if (event.animationName === 'plant-arrive') button.classList.remove('is-entering'); });
      if (plantObserver) plantObserver.observe(button);
      else button.classList.add('is-in-view');
    }
    existing.delete(project.id);
    button.classList.toggle('is-selected', selectedId === project.id);
    button.setAttribute('aria-pressed', String(selectedId === project.id));
    button.title = project.name || t("s34");
    button.setAttribute('aria-label', t("s35", { p0: project.name, p1: STATUS_LABELS[project.status], p2: formatDate(project.updatedAt) }));
    // Round the clock to a day: background refreshes do not restart wind animation.
    const growth = growthProfile(project, now);
    const specimen = { ...project, growthDays: Math.floor(growth.days), growthStartedAt: new Date(now).toISOString() };
    const state = project.status === 'active' ? growth.label : project.status === 'sleeping' ? t("s36") : t("s37");
    const markup = t("s38", { p0: String(index + 1).padStart(2, '0'), p1: botanicalPlantSvg(specimen, false, now), p2: escapeHtml(project.name || t("s34")), p3: escapeHtml(state), p4: escapeHtml(growth.speciesLabel), p5: Math.floor(growth.days), count: Math.floor(growth.days) });
    if (button._markup !== markup) {
      button.innerHTML = markup;
      button._markup = markup;
      const sceneSvg = button.querySelector('svg');
      sceneSvg.setAttribute('aria-hidden', 'true');
      sceneSvg.removeAttribute('role');
      sceneSvg.removeAttribute('aria-label');
      sceneSvg.querySelector('title')?.remove();
    }
    if (refs.layer.children[index] !== button) refs.layer.insertBefore(button, refs.layer.children[index] || null);
  });
  existing.forEach((button) => { plantObserver?.unobserve(button); button.remove(); });
  refs.count.textContent = isFiltered
    ? t("s39", { p0: visible.length, p1: projects.length, p2: pluralize(projects.length, t("s40"), t("s41"), t("s42")) })
    : `${projects.length} ${pluralize(projects.length, t("s40"), t("s41"), t("s42"))}`;
  refs.lastSync.textContent = lastSavedAt ? t("s43", { p0: formatDate(lastSavedAt) }) : t("s44");
  const counts = countByStatus(projects);
  refs.filterCounts.all.textContent = String(counts.all);
  refs.filterCounts.active.textContent = String(counts.active);
  refs.filterCounts.sleeping.textContent = String(counts.sleeping);
  refs.filterCounts.archived.textContent = String(counts.archived);
  refs.filters.forEach((filter) => filter.classList.toggle('is-active', filter.dataset.filter === activeFilter));
  refs.filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter.dataset.filter === activeFilter)));
  refs.sceneDate.textContent = new Date(now).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' });
  renderInspector();
}

function pluralize(value, one, few, many) {
  if (getLocale() === 'en') return value === 1 ? one : many;
  const mod = value % 100;
  if (mod >= 11 && mod <= 14) return many;
  switch (value % 10) { case 1: return one; case 2: case 3: case 4: return few; default: return many; }
}

function selectProject(id) {
  if (isNewProject && selectedId && selectedId !== id) projects = projects.filter((item) => item.id !== selectedId);
  selectedId = id;
  isNewProject = false;
  render();
  if (globalThis.matchMedia?.('(max-width: 900px)').matches) refs.form.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() || !motionEnabled ? 'auto' : 'smooth' });
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
    inspectorKey = '';
    return;
  }
  const key = JSON.stringify(project);
  const growth = growthProfile(project);
  const previewKey = `${project.id}:${project.status}:${project.color}:${Math.floor(growth.days)}`;
  if (refs.preview.dataset.key !== previewKey) {
    refs.preview.innerHTML = botanicalPlantSvg(project, true);
    refs.preview.dataset.key = previewKey;
  }
  refs.species.textContent = growth.speciesLabel;
  refs.growthStage.textContent = project.status === 'archived' ? t("s37") : project.status === 'sleeping' ? t("s45") : growth.label;
  refs.growthDays.textContent = t("s46", { p0: Math.floor(growth.days), count: Math.floor(growth.days) });
  refs.growthFill.style.width = `${Math.min(100, growth.days / 90 * 100)}%`;
  refs.statusAge.textContent = `${formatDate(project.updatedAt)} · ${relativeAge(project)}`;
  if (key === inspectorKey) return;
  inspectorKey = key;
  refs.form.hidden = false;
  refs.inspectorEmpty.hidden = true;
  refs.panelIndex.textContent = String(projects.findIndex((item) => item.id === project.id) + 1).padStart(2, '0');
  refs.id.value = project.id;
  refs.name.value = project.name;
  refs.description.value = project.description;
  refs.status.value = project.status;
  refs.color.value = project.color;
  refs.updated.value = toInputDate(project.updatedAt);
  refs.note.value = project.note;
  refs.nextStep.value = project.nextStep;
  refs.statusCopy.textContent = STATUS_SHORT[project.status];
  refs.statusAge.textContent = `${formatDate(project.updatedAt)} · ${relativeAge(project)}`;
  refs.statusMarker.style.color = project.status === 'sleeping' ? 'var(--ochre)' : project.status === 'archived' ? 'var(--terracotta)' : 'var(--moss)';
  refs.statusMarker.style.background = project.status === 'sleeping' ? 'transparent' : 'currentColor';
}

function openNewProject() {
  activeFilter = 'all';
  searchQuery = '';
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
  const duplicate = normalizeProject({ ...source, id: uid(), name: t("s47", { p0: source.name }).slice(0, 60), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), growthDays: 0, growthStartedAt: new Date().toISOString() });
  projects.push(duplicate);
  selectedId = duplicate.id;
  isNewProject = true;
  render();
  refs.name.focus();
  showToast(t("s48"));
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
    showToast(t("s49"));
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
    ...transitionGrowth(project || {}, refs.status.value),
  }, refs.id.value);
  const nextProjects = projects.map((item) => item.id === payload.id ? payload : item);
  try {
    const result = await commitProjects(nextProjects);
    isNewProject = false;
    showToast(result.fallback ? t("s50") : t("s51"));
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(t("s52", { p0: error?.message || t("s53") }));
    render();
  }
}

async function deleteSelected() {
  const project = projects.find((item) => item.id === selectedId);
  if (!project) return;
  if (!window.confirm(t("s54", { p0: project.name || t("s55") }))) return;
  const previousProjects = projects;
  const previousSelectedId = selectedId;
  const previousIsNew = isNewProject;
  try {
    const result = await commitProjects(projects.filter((item) => item.id !== project.id));
    selectedId = null;
    isNewProject = false;
    showToast(result.fallback ? t("s56") : t("s57"));
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(t("s52", { p0: error?.message || t("s53") }));
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
  refs.fileNote.textContent = t("s58", { p0: file.name, p1: (Number(file.size) / 1024).toFixed(1) });
  try {
    if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
      const fileSize = Number(file.size);
      if (Number.isFinite(fileSize) && fileSize > MAX_JSON_BYTES) throw new Error(t("s59"));
      const source = typeof file.slice === 'function' ? file.slice(0, MAX_JSON_BYTES + 1) : file;
      const text = await source.text();
      let textBytes;
      try { textBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : text.length; } catch { textBytes = text.length; }
      if (textBytes > MAX_JSON_BYTES) throw new Error(t("s60"));
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(t("s61")); }
      const parsed = parseProjectPayload(data, { byteLength: Number.isFinite(fileSize) ? fileSize : textBytes });
      if (!parsed.projects.length) throw new Error(t("s62"));
      const merged = mergeProjects(projects, parsed.projects);
      const result = await commitProjects(merged.projects);
      selectedId = merged.importedIds?.[0] || merged.projects[0]?.id || null;
      isNewProject = false;
      const skipped = parsed.skipped + merged.skipped;
      const suffix = t("s63", { p0: merged.imported, p1: skipped, p2: merged.collisions });
      showToast(result.fallback ? t("s64", { p0: suffix }) : suffix);
    } else if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      const fileSize = Number(file.size);
      if (fileSize > MAX_ZIP_BYTES) throw new Error(t("s65"));
      const metadata = await readZipMetadata(await file.arrayBuffer(), file.name);
      const project = normalizeProject({
        id: uid(),
        name: metadata.name,
        description: t("s66", { p0: metadata.files.length, p1: formatBytes(metadata.totalBytes) }),
        color: COLORS[projects.length % COLORS.length],
        status: 'active',
        updatedAt: metadata.updatedAt,
        files: metadata.files,
        source: 'zip',
        get nextStep() { return t("s67"); },
      });
      const merged = mergeProjects(projects, [project]);
      const result = await commitProjects(merged.projects);
      selectedId = merged.importedIds?.[0] || project.id;
      isNewProject = false;
      const suffix = t("s68", { p0: metadata.files.length, p1: metadata.truncated });
      showToast(result.fallback ? t("s64", { p0: suffix }) : suffix);
    } else {
      throw new Error(t("s69"));
    }
    render();
  } catch (error) {
    projects = previousProjects;
    selectedId = previousSelectedId;
    isNewProject = previousIsNew;
    showToast(error?.message || t("s70"));
    render();
  } finally {
    refs.fileInput.value = '';
  }
}

function readZipMetadata(arrayBuffer, filename) {
  if (!arrayBuffer || !Number.isFinite(arrayBuffer.byteLength) || arrayBuffer.byteLength > MAX_ZIP_BYTES) throw new Error(t("s65"));
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 22) throw new Error(t("s71"));
  const view = new DataView(arrayBuffer);
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error(t("s71"));
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength > bytes.length) throw new Error(t("s72"));
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const directoryEnd = directoryOffset + directorySize;
  if (entries > MAX_ZIP_ENTRIES || directoryOffset > bytes.length || directoryEnd > bytes.length || directoryEnd > eocd) throw new Error(t("s73"));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = [];
  const names = new Set();
  let truncated = 0;
  let totalBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error(t("s74"));
    const centralCursor = cursor;
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error(t("s75"));
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error(t("s76"));
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLength + extraLength + commentLen;
    if (nextCursor > directoryEnd || nextCursor > eocd) throw new Error(t("s77"));
    let name;
    try { name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength)); } catch { throw new Error(t("s78")); }
    // Verify each local record stays before the central directory; no payload is decompressed.
    const localOffset = view.getUint32(centralCursor + 42, true);
    if (localOffset + 30 > directoryOffset || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(t("s79"));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localDataEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    if (localDataEnd > directoryOffset || localDataEnd > bytes.length) throw new Error(t("s80"));
    cursor = nextCursor;
    const modifiedAt = dosDateTimeToIso(view.getUint16(centralCursor + 14, true), view.getUint16(centralCursor + 12, true));
    const normalized = normalizeFile({ name, extension: extensionOf(name), size: uncompressedSize, modifiedAt });
    if (!normalized || names.has(normalized.name)) { truncated += 1; continue; }
    names.add(normalized.name);
    if (files.length >= MAX_ZIP_FILES) { truncated += 1; continue; }
    files.push(normalized);
  }
  if (cursor !== directoryEnd) throw new Error(t("s81"));
  const newest = files.map((file) => file.modifiedAt).filter(Boolean).sort().pop();
  return { name: String(filename || t("s82")).replace(/\.zip$/i, ''), files, totalBytes, truncated, updatedAt: newest || new Date().toISOString() };
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
  if (!blob) throw new Error(t("s83"));
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
    showToast(t("s84"));
  } catch (error) {
    showToast(t("s85", { p0: error?.message || t("s86") }));
  }
}

async function exportPng() {
  refs.exportPng.disabled = true;
  try {
    const sorted = filterAndSortProjects(projects, { filter: activeFilter, query: searchQuery, sort: sortMode });
    const blob = await gardenPng(sorted);
    downloadBlob(blob, `project-garden-${new Date().toISOString().slice(0, 10)}.png`);
    showToast(t("s87"));
  } catch (error) {
    showToast(t("s88", { p0: error?.message || t("s86") }));
  } finally {
    refs.exportPng.disabled = false;
  }
}

function updateMotion() {
  const reduced = prefersReducedMotion();
  document.documentElement.dataset.motion = motionEnabled && !reduced ? 'on' : 'off';
  refs.motionToggle.setAttribute('aria-pressed', String(motionEnabled && !reduced));
  refs.motionToggle.textContent = reduced ? t("s89") : motionEnabled ? t("s90") : t("s91");
  refs.motionToggle.disabled = reduced;
  refs.motionToggle.title = reduced ? t("s92") : t("s93");
}

function openGrowthPreview() {
  growthPreviewProject = projects.find((project) => project.id === selectedId);
  if (!growthPreviewProject) return;
  refs.growthSpecimen.replaceChildren();
  refs.growthProjectName.textContent = growthPreviewProject.name || t("s34");
  refs.growthSlider.value = String(Math.min(90, Math.floor(growthProfile(growthPreviewProject).days)));
  renderGrowthPreview();
  refs.growthDialog.showModal();
}

function renderGrowthPreview() {
  if (!growthPreviewProject) return;
  const days = Number(refs.growthSlider.value);
  const now = Date.now();
  const specimen = { ...growthPreviewProject, status: 'active', growthDays: days, growthStartedAt: new Date(now).toISOString() };
  const variant = `${growthProfile(specimen, now).tier}:${days < 4}`;
  const template = document.createElement('template');
  template.innerHTML = botanicalPlantSvg(specimen, false, now);
  const nextSvg = template.content.firstElementChild;
  const currentSvg = refs.growthSpecimen.firstElementChild;
  if (currentSvg && refs.growthSpecimen.dataset.variant === variant) {
    currentSvg.querySelector('.plant-growth').setAttribute('transform', nextSvg.querySelector('.plant-growth').getAttribute('transform'));
  } else {
    refs.growthSpecimen.replaceChildren(nextSvg);
    if (motionEnabled && !prefersReducedMotion()) nextSvg.animate([{ opacity: .45, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, easing: 'ease-out' });
  }
  refs.growthSpecimen.dataset.variant = variant;
  refs.growthPreviewStage.textContent = growthProfile(specimen, now).label;
  refs.growthPreviewDays.textContent = `${days} ${pluralize(days, t("s94"), t("s95"), t("s96"))}`;
}

function bindEvents() {
  try { motionEnabled = localStorage.getItem('project-garden-motion') !== 'off'; } catch { /* use system setting */ }
  updateMotion();
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener('change', updateMotion);
  refs.motionToggle.addEventListener('click', () => {
    motionEnabled = !motionEnabled;
    try { localStorage.setItem('project-garden-motion', motionEnabled ? 'on' : 'off'); } catch { /* works for this visit */ }
    updateMotion();
  });
  refs.previewGrowth.addEventListener('click', openGrowthPreview);
  refs.closeGrowth.addEventListener('click', () => refs.growthDialog.close());
  refs.growthSlider.addEventListener('input', renderGrowthPreview);
  refs.growthDialog.addEventListener('click', (event) => {
    if (event.target !== refs.growthDialog) return;
    const rect = refs.growthDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) refs.growthDialog.close();
  });
  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.pageVisible = String(!document.hidden);
    if (!document.hidden) render();
  });
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
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedId && !refs.growthDialog.open) {
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
  refs.emptySpecimen.innerHTML = botanicalPlantSvg({ id: 'b', color: '#718b6a', growthDays: 55, growthStartedAt: new Date().toISOString() }, true);
  try { db = await openDatabase(); } catch { db = null; showToast(t("s97")); }
  let stored = [];
  try { stored = await readProjects(); } catch { db = null; showToast(t("s98")); }
  const mirror = readMirror();
  const chosen = chooseStoredProjects(stored, mirror);
  if (chosen.source === 'none') {
    freshDemoGarden = true;
    try {
      await commitProjects(DEMO_PROJECTS);
    } catch (error) {
      projects = normalizeProjectList(DEMO_PROJECTS);
      showToast(t("s99", { p0: error?.message || t("s53") }));
    }
  } else {
    projects = chosen.projects;
    revision = chosen.source === 'stored' ? Number(storedMeta?.revision) || 0 : mirror.revision;
    lastSavedAt = chosen.source === 'stored' ? storedMeta?.savedAt || null : mirror.savedAt;
    const needsMigration = mirror.legacy || chosen.source === 'stored' || !mirror.savedAt;
    if (needsMigration) {
      try { await commitProjects(projects); } catch (error) { showToast(t("s100", { p0: error?.message || t("s101") })); }
    }
  }
  render();
  window.setInterval(() => { if (!document.hidden) render(); }, 60000);
}

mountLocale(previous => {
  if (freshDemoGarden) {
    // Only untouched fields of examples seeded in this session follow the locale.
    // Existing stored projects are always user data, even if they resemble an example.
    const defaults = {
      'project-studio': { name:'s0', description:'s1', note:'s2', nextStep:'s3' },
      'field-notes': { name:'s4', description:'s5', note:'s6', nextStep:'s7' },
      bloom: { name:'s8', description:'s9', note:'s10', nextStep:'s11' },
      journal: { name:'s12', description:'s13', note:'s14', nextStep:'s15' },
      library: { name:'s16', description:'s17', note:'s18' },
    };
    const selected = projects.find(project => project.id === selectedId);
    const before = selected ? {...selected} : null;
    for (const project of projects) for (const [field,key] of Object.entries(defaults[project.id] || {})) {
      if (project[field] === dictionaries[previous][key]) project[field] = t(key);
    }
    if (selected) {
      for (const field of ['name','description','note','nextStep']) if (refs[field].value === before[field]) refs[field].value = selected[field];
      inspectorKey = JSON.stringify(selected);
    }
  }
  refs.preview.dataset.key = '';
  render();
  if (selectedId) refs.statusCopy.textContent = STATUS_SHORT[refs.status.value];
  updateMotion();
  if (refs.growthDialog.open) renderGrowthPreview();
  refs.toast.textContent = translateMessage(refs.toast.textContent, previous);
});
init();
