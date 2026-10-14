import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../garden-core.js', import.meta.url), 'utf8');
const core = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
const { normalizeProject, normalizeFile, parseProjectPayload, mergeProjects, filterAndSortProjects, relativeAge, countByStatus } = core;

const now = new Date('2026-10-08T00:00:00.000Z');

test('normalization is deterministic and bounded', () => {
  const raw = { id: 'same', name: '  Проект  ', description: 'x'.repeat(300), status: 'dormant', color: 'bad' };
  const first = normalizeProject(raw);
  const second = normalizeProject(raw);
  assert.equal(first.color, second.color);
  assert.equal(first.status, 'sleeping');
  assert.equal(first.name, 'Проект');
  assert.equal(first.description.length, 220);
  assert.equal(first.files.length, 0);
});

test('payload parser enforces size and project limits while skipping invalid entries', () => {
  const payload = [{ id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, null, 'bad', { id: 'b', updatedAt: '2026-02-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z' }];
  assert.deepEqual(parseProjectPayload(payload), { projects: [normalizeProject(payload[0]), normalizeProject(payload[3])], skipped: 2 });
  assert.equal(parseProjectPayload(payload, { byteLength: core.MAX_JSON_BYTES + 1 }).skipped, 4);
  const tooMany = parseProjectPayload(Array.from({ length: 501 }, (_, i) => ({ id: String(i) })));
  assert.equal(tooMany.projects.length, 500);
  assert.equal(tooMany.skipped, 1);
});

test('merge deduplicates incoming ids without mutating inputs', () => {
  const existing = [{ id: 'same', name: 'Old' }];
  const incoming = [{ id: 'same', name: 'New' }, { id: 'fresh', name: 'Fresh' }, null];
  const result = mergeProjects(existing, incoming);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.collisions, 1);
  assert.equal(result.projects.length, 3);
  assert.equal(result.projects.filter((p) => p.id === 'same').length, 1);
  assert.equal(existing[0].name, 'Old');
});

test('search and sorting cover metadata and files', () => {
  const projects = [
    normalizeProject({ id: 'old', name: 'Beta', status: 'archived', updatedAt: '2026-01-01', files: [{ name: 'README.md' }] }),
    normalizeProject({ id: 'new', name: 'Alpha', status: 'active', updatedAt: '2026-10-01' }),
    normalizeProject({ id: 'mid', name: 'Gamma', status: 'sleeping', updatedAt: '2026-05-01', note: 'Подготовить релиз' }),
  ];
  assert.deepEqual(filterAndSortProjects(projects).map((p) => p.id), ['new', 'mid', 'old']);
  assert.deepEqual(filterAndSortProjects(projects, { query: 'readme' }).map((p) => p.id), ['old']);
  assert.deepEqual(filterAndSortProjects(projects, { filter: 'active', sort: 'name' }).map((p) => p.id), ['new']);
  assert.deepEqual(filterAndSortProjects(projects, { sort: 'status' }).map((p) => p.id), ['new', 'mid', 'old']);
});

test('bad dates are safe and age accepts an explicit clock', () => {
  assert.equal(core.formatDate('not a date'), '-');
  assert.equal(relativeAge({ updatedAt: 'not a date' }, now), '-');
  assert.equal(relativeAge({ updatedAt: '2026-10-07T00:00:00Z' }, now), 'вчера');
  assert.equal(core.validDate(0), true);
  assert.equal(core.formatDate(0), '01 янв 1970 г.');
  assert.equal(relativeAge({ updatedAt: 0 }, 0), 'сегодня');
});

test('file paths reject traversal and unsafe names', () => {
  assert.equal(normalizeFile({ name: '../secret.txt' }), null);
  assert.equal(normalizeFile({ name: '/absolute.txt' }), null);
  assert.equal(normalizeFile({ name: 'C:' }), null);
  assert.equal(normalizeFile({ name: 'C:relative.txt' }), null);
  assert.equal(normalizeFile({ name: 'C:/absolute.txt' }), null);
  assert.equal(normalizeFile({ name: 'bad\u007fname.txt' }), null);
  assert.equal(normalizeFile({ name: 'safe\\folder\\readme.md' }).name, 'safe/folder/readme.md');
  assert.equal(normalizeFile({ name: 'safe/readme.md' }).extension, 'md');
  assert.equal(normalizeFile({ name: 'safe/readme.md', extension: '../../x' }), null);
  assert.equal(normalizeFile({ name: 'safe/readme.md', extension: 'Md' }).extension, 'md');
  assert.equal(normalizeFile({ name: 'safe/readme.md', size: Symbol('bad') }).size, 0);
  assert.equal(normalizeFile({ name: 'safe/readme.md', size: 1n }).size, 1);
});

test('filtering tolerates null projects, options, and file items', () => {
  assert.deepEqual(filterAndSortProjects(null, null), []);
  const projects = [null, 'bad', { id: 'ok', name: 'Keep', files: [null, 'bad', { name: 'needle.txt' }] }];
  assert.deepEqual(filterAndSortProjects(projects, { query: 'needle' }).map((project) => project.id), ['ok']);
});

test('helpers tolerate hostile scalar values and normalize ids', () => {
  assert.equal(core.formatBytes(Symbol('bytes')), '0 Б');
  assert.equal(core.formatBytes(Number.NaN), '0 Б');
  const project = normalizeProject({ id: `${'x'.repeat(200)}\u0000`, source: new String('ZIP') });
  assert.equal(project.id.length, 120);
  assert.equal(project.id.includes('\u0000'), false);
  assert.equal(project.source, 'zip');
});

test('payload shape and duplicate existing records are handled defensively', () => {
  assert.deepEqual(parseProjectPayload({ projects: [{ id: 'ok' }, null] }, null).skipped, 1);
  assert.equal(parseProjectPayload({ nope: true }).skipped, 1);
  assert.equal(parseProjectPayload([{ id: 'too-large' }], { byteLength: Infinity }).skipped, 1);
  const result = mergeProjects([{ id: 'same' }, { id: 'same' }, null], [{ id: 'same' }]);
  assert.equal(new Set(result.projects.map((project) => project.id)).size, result.projects.length);
  assert.equal(result.collisions, 2);
  assert.equal(result.skipped, 2);
});

test('uid returns unique ids', () => {
  assert.notEqual(core.uid(), core.uid());
});

test('status counts include all records', () => {
  assert.deepEqual(countByStatus([{ status: 'active' }, { status: 'sleeping' }, { status: 'unknown' }]), { all: 3, active: 1, sleeping: 1, archived: 0 });
  assert.deepEqual(countByStatus(null), { all: 0, active: 0, sleeping: 0, archived: 0 });
});

test('normalization migrates and preserves botanical clocks through json import', () => {
  const createdAt = '2026-09-01T00:00:00.000Z';
  const updatedAt = '2026-09-21T00:00:00.000Z';
  const legacy = normalizeProject({ id: 'clock', createdAt, updatedAt, status: 'sleeping' });
  assert.equal(legacy.growthDays, 20);
  assert.equal(legacy.growthStartedAt, updatedAt);
  const active = normalizeProject({ id: 'active', createdAt, updatedAt, status: 'active' });
  assert.equal(active.growthDays, 0);
  assert.equal(active.growthStartedAt, createdAt);
  const saved = normalizeProject({ ...active, growthDays: 12.5, growthStartedAt: updatedAt });
  assert.deepEqual(parseProjectPayload(JSON.parse(JSON.stringify([saved]))).projects, [saved]);
  assert.equal(normalizeProject({ growthDays: -5 }).growthDays, 0);
  assert.equal(normalizeProject({ growthDays: Symbol('bad') }).growthDays, 0);
});
