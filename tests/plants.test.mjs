import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../plants.js', import.meta.url), 'utf8');
const { plantSvg, growthProfile, transitionGrowth } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

const now = Date.parse('2026-10-08T00:00:00.000Z');
const project = (overrides = {}) => ({
  id: 'a',
  name: 'Маленький сад',
  color: '#b7644a',
  status: 'active',
  updatedAt: new Date(now - 20 * 86400000).toISOString(),
  ...overrides,
});

test('escapes titles and falls back from unsafe colors', () => {
  const svg = plantSvg(project({ name: '<script>&"', color: '"/><script>alert(1)</script>' }));
  assert.match(svg, /viewBox="0 0 240 340"/);
  assert.match(svg, /<title>&lt;script&gt;&amp;&quot;: активный рост<\/title>/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /#718b6a/);
});

test('maps ids to four distinct botanical species', () => {
  const outputs = ['a', 'b', 'c', 'd'].map((id) => plantSvg(project({ id })));
  assert.equal(new Set(outputs).size, 4);
  outputs.forEach((svg) => {
    assert.match(svg, /data-species="(shrub|fern|flower|tree)"/);
    assert.match(svg, /330/);
  });
});

test('changes active age tiers and simplifies sleeping and archived states', () => {
  const young = plantSvg(project({ updatedAt: new Date(now - 5 * 86400000).toISOString() }), false, now);
  const established = plantSvg(project({ updatedAt: new Date(now - 20 * 86400000).toISOString() }), false, now);
  const mature = plantSvg(project({ updatedAt: new Date(now - 60 * 86400000).toISOString() }), false, now);
  const sleeping = plantSvg(project({ status: 'sleeping' }), false, now);
  const archived = plantSvg(project({ status: 'archived' }), false, now);
  assert.match(young, /data-age-tier="young"/);
  assert.match(established, /data-age-tier="established"/);
  assert.match(mature, /data-age-tier="mature"/);
  assert.notEqual(young, established);
  assert.notEqual(established, mature);
  assert.match(sleeping, /data-state="sleeping"/);
  assert.match(archived, /data-state="archived"/);
  assert.match(archived, /seed/);
  assert.match(plantSvg(project(), true), /class="plant-svg compact"/);
});

test('growth follows planted time and does not shrink when a note is updated', () => {
  const planted = new Date(now - 30 * 86400000).toISOString();
  const before = project({ createdAt: planted });
  const after = { ...before, updatedAt: new Date(now).toISOString(), note: 'новая заметка' };
  assert.equal(typeof growthProfile, 'function');
  assert.equal(growthProfile(before, now).days, 30);
  assert.equal(growthProfile(after, now).days, 30);
  assert.equal(plantSvg(before, false, now), plantSvg(after, false, now));
});

test('pausing and resuming preserve accumulated growth through multiple seasons', () => {
  assert.equal(typeof transitionGrowth, 'function');
  const active = project({ growthDays: 8, growthStartedAt: new Date(now - 6 * 86400000).toISOString() });
  const paused = { ...active, ...transitionGrowth(active, 'sleeping', now), status: 'sleeping' };
  assert.equal(growthProfile(paused, now + 20 * 86400000).days, 14);
  const resumedAt = now + 20 * 86400000;
  const resumed = { ...paused, ...transitionGrowth(paused, 'active', resumedAt), status: 'active' };
  assert.equal(growthProfile(resumed, resumedAt + 5 * 86400000).days, 19);
  const archived = { ...resumed, ...transitionGrowth(resumed, 'archived', resumedAt + 5 * 86400000), status: 'archived' };
  assert.equal(growthProfile(archived, resumedAt + 90 * 86400000).days, 19);
});

test('growth clamps future dates and malformed clocks and changes within a stage', () => {
  assert.equal(typeof growthProfile, 'function');
  assert.equal(growthProfile({ createdAt: 'bad', updatedAt: 'bad', growthDays: -10 }, now).days, 0);
  assert.equal(growthProfile({ growthDays: Infinity, growthStartedAt: 'bad' }, now).days, 0);
  assert.equal(growthProfile({ createdAt: new Date(now + 86400000).toISOString() }, now).days, 0);
  const early = project({ growthDays: 1, growthStartedAt: new Date(now).toISOString() });
  const later = { ...early, growthDays: 10 };
  assert.equal(growthProfile(early, now).tier, growthProfile(later, now).tier);
  assert.notEqual(plantSvg(early, false, now), plantSvg(later, false, now));
});
