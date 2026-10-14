export const STATUS_LABELS = { active: 'активный рост', sleeping: 'в спячке', archived: 'в архиве' };
export const STATUS_SHORT = { active: 'активен', sleeping: 'в спячке', archived: 'архив' };
export const COLORS = ['#b7644a', '#445344', '#c89b4b', '#718b6a', '#7d6752'];

export const MAX_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_JSON_PROJECTS = 500;
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 10000;
export const MAX_ZIP_FILES = 500;

const STATUS_ORDER = ['active', 'sleeping', 'archived'];
const DAY = 86400000;

export function uid() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* use fallback */ }
  return `plant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function text(value, fallback = '') {
  try { return value == null ? fallback : String(value); } catch { return fallback; }
}

export function validDate(value) {
  try {
    if (value === null || value === undefined || value === '') return false;
    return !Number.isNaN(new Date(value).getTime());
  } catch { return false; }
}

export function extensionOf(name) {
  const base = text(name).replaceAll('\\', '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function normalizeFile(file) {
  if (!file || typeof file !== 'object') return null;
  const rawName = text(file.name).replaceAll('\\', '/');
  const parts = rawName.split('/');
  if (!rawName || rawName.startsWith('/') || /^[A-Za-z]:/.test(rawName) || parts.some((part) => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(rawName)) return null;
  const name = rawName.slice(0, 180);
  let sizeValue;
  try { sizeValue = Number(file.size); } catch { sizeValue = 0; }
  const suppliedExtension = text(file.extension).trim().toLowerCase();
  const extension = suppliedExtension || extensionOf(name);
  if (!/^[a-z0-9+#.-]{0,12}$/.test(extension)) return null;
  return {
    name,
    extension,
    size: Number.isFinite(sizeValue) ? Math.max(0, sizeValue) : 0,
    modifiedAt: validDate(file.modifiedAt) ? new Date(file.modifiedAt).toISOString() : null,
  };
}

function colorFor(id, name) {
  const key = `${text(id)}|${text(name)}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return COLORS[(hash >>> 0) % COLORS.length];
}

export function normalizeProject(raw = {}, forcedId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawId = text(forcedId || source.id || uid()).trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  const id = rawId || uid();
  const name = text(source.name || source.title || 'без названия').trim().slice(0, 60) || 'без названия';
  const statusValue = source.status === 'dormant' ? 'sleeping' : source.status;
  const status = STATUS_ORDER.includes(statusValue) ? statusValue : 'active';
  const updatedAt = validDate(source.updatedAt) ? new Date(source.updatedAt).toISOString() : new Date().toISOString();
  const createdAt = validDate(source.createdAt) ? new Date(source.createdAt).toISOString() : updatedAt;
  let growthDays;
  try { growthDays = Number(source.growthDays); } catch { growthDays = NaN; }
  if (source.growthDays == null || !Number.isFinite(growthDays)) {
    growthDays = status === 'active' ? 0 : Math.max(0, (new Date(updatedAt) - new Date(createdAt)) / DAY);
  }
  growthDays = Math.min(36500, Math.max(0, growthDays));
  const growthStartedAt = validDate(source.growthStartedAt) ? new Date(source.growthStartedAt).toISOString() : status === 'active' ? createdAt : updatedAt;
  const files = Array.isArray(source.files) ? source.files.slice(0, MAX_ZIP_FILES).map(normalizeFile).filter(Boolean) : [];
  return {
    id,
    name,
    description: text(source.description).trim().slice(0, 220),
    color: /^#[0-9a-f]{6}$/i.test(text(source.color)) ? text(source.color).toLowerCase() : colorFor(source.id || name, name),
    status,
    updatedAt,
    note: text(source.note).trim().slice(0, 240),
    nextStep: text(source.nextStep || source.next_step).trim().slice(0, 120),
    files,
    source: text(source.source).trim().toLowerCase() === 'zip' ? 'zip' : 'manual',
    createdAt,
    growthDays,
    growthStartedAt,
  };
}

export function formatBytes(value) {
  let bytes;
  try { bytes = Number(value); } catch { return '0 Б'; }
  if (!Number.isFinite(bytes) || bytes < 0) return '0 Б';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
}

export function formatDate(value) {
  if (!validDate(value)) return '-';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)).replace('.', ''); } catch { return '-'; }
}

export function relativeAge(projectOrDate, now = new Date()) {
  const value = projectOrDate && typeof projectOrDate === 'object' ? projectOrDate.updatedAt : projectOrDate;
  if (!validDate(value) || !validDate(now)) return '-';
  const age = Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / DAY));
  if (age === 0) return 'сегодня';
  if (age === 1) return 'вчера';
  return `${age} дн.`;
}

export function parseProjectPayload(payload, options = {}) {
  const { byteLength } = options && typeof options === 'object' ? options : {};
  const list = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray(payload.projects) ? payload.projects : null;
  if (!list) return { projects: [], skipped: 1 };
  let bytes;
  try { bytes = Number(byteLength); } catch { bytes = NaN; }
  if (bytes === Infinity || (Number.isFinite(bytes) && bytes > MAX_JSON_BYTES)) return { projects: [], skipped: list.length };
  const accepted = list.slice(0, MAX_JSON_PROJECTS);
  const skippedLimit = Math.max(0, list.length - accepted.length);
  const projects = [];
  let skipped = skippedLimit;
  for (const item of accepted) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { skipped += 1; continue; }
    try { projects.push(normalizeProject(item)); } catch { skipped += 1; }
  }
  return { projects, skipped };
}

export function mergeProjects(existing = [], incoming = []) {
  const projects = [];
  const used = new Set();
  let imported = 0; let skipped = 0; let collisions = 0;
  const importedIds = [];
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { skipped += 1; continue; }
    let project;
    try { project = normalizeProject(item); } catch { skipped += 1; continue; }
    if (used.has(project.id)) { collisions += 1; skipped += 1; continue; }
    used.add(project.id); projects.push(project);
  }
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { skipped += 1; continue; }
    let project;
    try { project = normalizeProject(item); } catch { skipped += 1; continue; }
    if (used.has(project.id)) { collisions += 1; do { project = normalizeProject(project, uid()); } while (used.has(project.id)); }
    used.add(project.id); projects.push(project); imported += 1; importedIds.push(project.id);
  }
  return { projects, imported, skipped, collisions, importedIds };
}

export function filterAndSortProjects(projects = [], options = {}) {
  const { filter = 'all', query = '', sort = 'updated' } = options && typeof options === 'object' ? options : {};
  const needle = text(query).trim().toLocaleLowerCase('ru-RU');
  const result = (Array.isArray(projects) ? projects : []).filter((project) => {
    if (!project || typeof project !== 'object') return false;
    if (filter !== 'all' && project.status !== filter) return false;
    if (!needle) return true;
    const files = Array.isArray(project.files) ? project.files.filter((file) => file && typeof file === 'object') : [];
    const haystack = [project.name, project.description, project.note, project.nextStep, ...files.flatMap((file) => [file.name, file.extension])].map(text).join(' ').toLocaleLowerCase('ru-RU');
    return haystack.includes(needle);
  }).map((project) => project);
  result.sort((a, b) => {
    if (sort === 'name') return text(a.name).localeCompare(text(b.name), 'ru');
    if (sort === 'status') return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || text(a.name).localeCompare(text(b.name), 'ru');
    const aTime = validDate(a.updatedAt) ? new Date(a.updatedAt).getTime() : -Infinity;
    const bTime = validDate(b.updatedAt) ? new Date(b.updatedAt).getTime() : -Infinity;
    return (bTime - aTime) || text(a.name).localeCompare(text(b.name), 'ru');
  });
  return result;
}

export function countByStatus(projects = []) {
  return (Array.isArray(projects) ? projects : []).reduce((counts, project) => {
    if (STATUS_ORDER.includes(project?.status)) counts[project.status] += 1;
    counts.all += 1;
    return counts;
  }, { all: 0, active: 0, sleeping: 0, archived: 0 });
}
