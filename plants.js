const DAY = 86400000;
const SPECIES = ['shrub', 'fern', 'flower', 'tree'];
const SPECIES_LABELS = ['куст', 'папоротник', 'космея', 'дерево'];
const STATUS_LABELS = { active: 'активный рост', sleeping: 'в спячке', archived: 'в архиве' };
const FALLBACK_ACCENT = '#718b6a';
const STEM = '#5d745f';
const STEM_DARK = '#4d6651';
const SAGE = '#9caf8f';
const SAGE_LIGHT = '#c4d0b2';
const DRY = '#a28e67';
const DRY_DARK = '#7f6d50';
const SEED = '#c5a979';
const GOLD = '#d6ad62';

function timeOf(value) {
  if (value == null || value === '') return NaN;
  try { return new Date(value).getTime(); } catch { return NaN; }
}

/** Accumulated active days; editing a project's notes never resets its age. */
export function growthProfile(project = {}, now = Date.now()) {
  const current = timeOf(now);
  const created = timeOf(project.createdAt ?? project.updatedAt);
  const updated = timeOf(project.updatedAt);
  let accumulated;
  try { accumulated = Number(project.growthDays); } catch { accumulated = NaN; }
  if (project.growthDays == null || !Number.isFinite(accumulated)) {
    accumulated = project.status === 'sleeping' || project.status === 'archived' ? Math.max(0, (updated - created) / DAY) : 0;
  }
  accumulated = Number.isFinite(accumulated) ? Math.max(0, accumulated) : 0;
  const started = timeOf(project.growthStartedAt ?? project.createdAt ?? project.updatedAt);
  const elapsed = project.status === 'sleeping' || project.status === 'archived' || !Number.isFinite(started) || !Number.isFinite(current) ? 0 : Math.max(0, (current - started) / DAY);
  const days = Math.min(36500, accumulated + elapsed);
  const tier = days < 14 ? 'young' : days < 45 ? 'established' : 'mature';
  const progress = tier === 'young' ? days / 14 : tier === 'established' ? (days - 14) / 31 : Math.min(1, (days - 45) / 45);
  const speciesIndex = hashId(String(project.id ?? ''));
  return { days, tier, progress, label: tier === 'young' ? 'росток' : tier === 'established' ? 'набирает силу' : 'зрелое растение', species: SPECIES[speciesIndex], speciesLabel: SPECIES_LABELS[speciesIndex] };
}

export function transitionGrowth(project, nextStatus, now = Date.now()) {
  if (project.status === nextStatus && Number.isFinite(project.growthDays) && Number.isFinite(timeOf(project.growthStartedAt))) {
    return { growthDays: project.growthDays, growthStartedAt: project.growthStartedAt };
  }
  return { growthDays: growthProfile(project, now).days, growthStartedAt: new Date(now).toISOString() };
}

/**
 * Render a project as a small, flat botanical illustration.
 * The module deliberately has no DOM or stylesheet dependency so it can be used
 * by the garden view and by an export renderer alike.
 */
export function plantSvg(project = {}, compact = false, now = Date.now()) {
  const id = String(project?.id ?? '');
  const speciesIndex = hashId(id) % SPECIES.length;
  const species = SPECIES[speciesIndex];
  const status = ['active', 'sleeping', 'archived'].includes(project?.status) ? project.status : 'active';
  const accent = safeColor(project?.color);
  const name = String(project?.name ?? '').trim() || 'без названия';
  const title = `${name}: ${STATUS_LABELS[status]}`;
  const growth = growthProfile(project, now);
  const ageTier = growth.tier;
  const classes = `plant-svg${compact ? ' compact' : ''}`;
  const attrs = [
    `class="${classes}"`,
    'viewBox="0 0 240 340"',
    'role="img"',
    `aria-label="${escapeSvg(title)}"`,
    `data-species="${species}"`,
    `data-status="${status}"`,
    `data-state="${status}"`,
    `data-age-tier="${ageTier}"`,
  ].join(' ');

  let body;
  if (status === 'sleeping') body = renderSleeping(speciesIndex, accent);
  else if (status === 'archived') body = renderArchived(speciesIndex, accent);
  else body = growth.days < 4 ? renderSprout(accent, speciesIndex) : renderActive(speciesIndex, ageTier, accent);

  const sizeProgress = Math.min(1, growth.days / 90);
  const scaleY = status === 'active' ? (0.83 + sizeProgress * 0.17).toFixed(3) : '1';
  const scaleX = status === 'active' ? (0.92 + sizeProgress * 0.08).toFixed(3) : '1';
  const roots = '<g class="plant-roots" fill="none" stroke="#9f8c70" stroke-width="1" opacity=".45"><path d="M120 330v9m0-6-8 6m8-6 8 6m-8-4-3 4"/></g>';
  return `<svg ${attrs}><title>${escapeSvg(title)}</title>${roots}<g class="plant-sway"><g class="plant-growth" transform="translate(120 330) scale(${scaleX} ${scaleY}) translate(-120 -330)">${body}</g></g></svg>`;
}

function safeColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK_ACCENT;
}

function escapeSvg(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function hashId(id) {
  let hash = 0;
  for (const character of id) hash = (hash + character.codePointAt(0)) % 65521;
  return hash % SPECIES.length;
}

function renderSprout(accent, index) {
  return `<g data-botanical="new-sprout">${stem('M120 330 C117 306 122 288 120 268', 3)}${leaf('M120 297 C99 300 84 290 79 274 C98 271 114 280 120 297Z', accent, .78, leafDetail('M119 294 85 278'))}${leaf('M120 283 C132 266 148 259 161 263 C156 279 141 288 120 283Z', accent, .9, leafDetail('M123 281 154 266'))}${index === 2 ? `<ellipse cx="120" cy="267" rx="4" ry="7" fill="${accent}"/>` : ''}</g>`;
}

function stem(d, width = 4, color = STEM, opacity = 1) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
}

function leaf(d, accent, opacity = 0.86, detail = '') {
  return `<g class="plant-leaf"><path d="${d}" fill="${accent}" fill-opacity="${opacity}" stroke="${STEM}" stroke-width="1.35" stroke-linejoin="round"/>${detail}</g>`;
}

function leafDetail(d, opacity = 0.46) {
  return `<path d="${d}" fill="none" stroke="${STEM_DARK}" stroke-width="1" stroke-linecap="round" opacity="${opacity}"/>`;
}

function leaflet(x, y, rotation, scale = 1, accent, opacity = 0.8) {
  return `<path d="M0 0 C8 -8 18 -8 25 0 C17 8 7 8 0 0Z" transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})" fill="${accent}" fill-opacity="${opacity}" stroke="${STEM}" stroke-width="1.1" stroke-linejoin="round"/>`;
}

function renderActive(index, tier, accent) {
  if (index === 0) return renderShrub(tier, accent);
  if (index === 1) return renderFern(tier, accent);
  if (index === 2) return renderFlower(tier, accent);
  return renderTree(tier, accent);
}

function renderShrub(tier, accent) {
  const young = tier === 'young';
  const mature = tier === 'mature';
  const top = young ? 226 : mature ? 92 : 156;
  const branchY = young ? 273 : mature ? 215 : 241;
  let out = '<g data-botanical="broad-branching-shrub">';
  out += stem(`M120 330 C116 296 118 262 120 ${top}`, 6, STEM_DARK);
  out += stem(`M119 ${branchY + 18} C100 ${branchY - 6} 79 ${branchY - 24} ${young ? 61 : 47} ${branchY - 38}`, 3.3);
  out += stem(`M121 ${branchY + 8} C142 ${branchY - 14} 160 ${branchY - 28} ${young ? 176 : 191} ${branchY - 48}`, 3.3);
  if (!young) {
    out += stem(`M120 ${top + 56} C102 ${top + 31} 88 ${top + 14} 73 ${top - 2}`, 2.5, STEM);
    out += stem(`M121 ${top + 43} C139 ${top + 19} 154 ${top + 7} 171 ${top - 15}`, 2.5, STEM);
  }
  const left = young
    ? 'M121 286 C99 286 77 276 64 258 C82 251 104 256 119 273 C123 278 124 283 121 286Z'
    : mature
      ? 'M121 264 C93 265 60 252 43 225 C69 215 100 222 120 244 C127 251 128 259 121 264Z'
      : 'M121 279 C95 278 71 267 56 245 C78 238 103 245 120 261 C125 267 126 274 121 279Z';
  const right = young
    ? 'M119 282 C137 263 157 255 179 259 C170 279 148 290 123 290 C120 288 119 285 119 282Z'
    : mature
      ? 'M119 260 C143 233 175 215 207 222 C198 250 165 267 124 271 C120 268 118 264 119 260Z'
      : 'M119 276 C140 251 168 238 194 245 C185 269 156 283 123 285 C120 283 119 280 119 276Z';
  out += leaf(left, accent, mature ? 0.9 : 0.82, leafDetail('M119 273 C94 264 79 254 67 242'));
  out += leaf(right, accent, mature ? 0.88 : 0.8, leafDetail('M122 280 C147 269 169 256 187 247'));
  if (!young) {
    out += leaf(mature
      ? 'M119 215 C91 220 68 207 58 182 C81 169 105 178 121 198 C126 204 125 211 119 215Z'
      : 'M120 234 C98 234 78 223 70 204 C89 195 109 202 122 218 C126 224 125 230 120 234Z', accent, mature ? 0.85 : 0.72,
      leafDetail(mature ? 'M119 208 C97 201 81 191 69 181' : 'M120 228 C102 220 89 211 77 204'));
    out += leaf(mature
      ? 'M121 201 C133 171 156 155 184 157 C180 184 157 204 127 209 C123 208 121 205 121 201Z'
      : 'M121 218 C136 194 155 183 177 187 C170 209 150 222 126 225 C123 224 121 221 121 218Z', accent, mature ? 0.84 : 0.7,
      leafDetail(mature ? 'M126 202 C145 188 160 174 177 161' : 'M126 218 C143 208 154 198 169 188'));
  }
  if (mature) {
    out += leaf('M118 163 C101 161 88 148 86 130 C103 127 117 137 123 151 C124 157 122 161 118 163Z', accent, 0.78, leafDetail('M118 157 C108 149 101 140 94 131'));
    out += leaf('M123 166 C135 140 153 125 175 126 C171 149 153 166 128 172 C125 171 123 169 123 166Z', accent, 0.76, leafDetail('M129 164 C145 149 156 136 169 128'));
  }
  out += `<path d="M87 302 C102 294 139 294 154 302 C144 316 99 316 87 302Z" fill="${SAGE_LIGHT}" fill-opacity=".34"/>`;
  return `${out}</g>`;
}

function fernFrond(path, leaves, accent, scale = 1) {
  let out = stem(path, 2.3, STEM, 0.95);
  for (const [x, y, angle, size] of leaves) {
    out += leaflet(x, y, angle, size * scale, accent, 0.74);
    out += leaflet(x, y, angle + 150, size * scale * .72, accent, .6);
  }
  return out;
}

function renderFern(tier, accent) {
  const young = tier === 'young';
  const mature = tier === 'mature';
  const top = young ? 195 : mature ? 72 : 127;
  let out = '<g data-botanical="airy-fern">';
  out += stem(`M120 330 C119 278 124 226 120 ${top}`, 4.3, STEM_DARK);
  const scale = young ? 0.72 : mature ? 1.02 : 0.88;
  out += fernFrond(`M120 290 C94 262 71 ${young ? 230 : 213} 58 ${young ? 191 : 160}`, [
    [107, 276, -154, 0.78], [95, 259, -163, 0.73], [83, 242, -169, 0.68], [72, 224, -177, 0.6],
  ], accent, scale);
  out += fernFrond(`M121 274 C145 246 163 ${young ? 215 : 188} 169 ${young ? 166 : 136}`, [
    [134, 261, -27, 0.78], [146, 244, -18, 0.72], [157, 224, -12, 0.65], [164, 203, -4, 0.58],
  ], accent, scale);
  if (!young) {
    out += fernFrond(`M120 239 C99 211 88 178 89 ${top + 8}`, [
      [111, 225, -146, 0.74], [103, 207, -157, 0.7], [98, 189, -164, 0.64], [94, 171, -171, 0.58],
    ], accent, scale);
    out += fernFrond(`M122 224 C139 194 146 165 146 ${top + 2}`, [
      [131, 210, -33, 0.72], [138, 191, -24, 0.66], [143, 172, -17, 0.6], [146, 153, -8, 0.52],
    ], accent, scale);
  }
  if (mature) {
    out += fernFrond(`M121 190 C111 157 111 122 121 82`, [
      [117, 174, -111, 0.65], [114, 155, -101, 0.62], [114, 136, -93, 0.56], [117, 116, -83, 0.48],
    ], accent, 0.92);
  }
  out += `<path d="M92 319 C104 313 135 313 148 319 C140 327 101 327 92 319Z" fill="${SAGE}" fill-opacity=".28"/>`;
  return `${out}</g>`;
}

function flowerPetal(angle, scale, accent, opacity = 0.9) {
  return `<path d="M0 0 C-11 -7 -13 -19 -5 -27 C4 -20 7 -10 0 0Z" transform="rotate(${angle}) scale(${scale})" fill="${accent}" fill-opacity="${opacity}" stroke="${STEM}" stroke-width="1.15" stroke-linejoin="round"/>`;
}

function flowerHead(x, y, scale, accent, tilt = 0) {
  return `<g data-element="flower" transform="translate(${x} ${y}) rotate(${tilt})">${Array.from({ length: 8 }, (_, i) => flowerPetal(i * 45, scale, accent, .72 + (i % 3) * .08)).join('')}<circle cx="0" cy="0" r="6" fill="${GOLD}" stroke="${STEM_DARK}" stroke-width="1"/><circle cx="-2" cy="-1" r="1" fill="${STEM_DARK}"/><circle cx="2" cy="2" r="1" fill="${STEM_DARK}"/></g>`;
}

function renderFlower(tier, accent) {
  const young = tier === 'young';
  const mature = tier === 'mature';
  const top = young ? 148 : mature ? 56 : 96;
  let out = '<g data-botanical="flowering-stem">';
  out += stem(`M120 330 C118 274 122 218 120 ${top}`, 4, STEM_DARK);
  out += stem(`M119 250 C102 233 92 213 88 188`, 2.2, STEM);
  out += stem(`M121 219 C139 199 149 177 151 ${mature ? 142 : 157}`, 2.2, STEM);
  out += leaf('M111 267 C94 261 84 248 83 234 C98 237 109 246 115 258 C116 263 114 266 111 267Z', accent, 0.65, leafDetail('M111 261 C100 253 92 245 87 237'));
  out += leaf('M128 237 C139 226 151 223 163 228 C156 241 143 248 128 247 C126 244 126 241 128 237Z', accent, 0.6, leafDetail('M131 242 C143 237 152 232 161 230'));
  out += flowerHead(120, top, young ? 0.78 : mature ? 1.12 : 0.96, accent, -5);
  if (!young) out += flowerHead(88, 186, mature ? 0.76 : 0.62, accent, -12);
  if (mature) {
    out += flowerHead(151, 143, 0.7, accent, 14);
    out += stem('M120 185 C111 162 107 140 108 119', 1.9, STEM);
    out += leaf('M111 167 C99 157 95 145 98 133 C110 139 115 149 114 161 C114 165 113 167 111 167Z', accent, 0.55, leafDetail('M111 161 C105 151 102 143 100 135'));
  }
  out += `<path d="M92 321 C105 313 136 313 149 321 C136 331 104 331 92 321Z" fill="${SAGE_LIGHT}" fill-opacity=".3"/>`;
  return `${out}</g>`;
}

function renderTree(tier, accent) {
  const young = tier === 'young';
  const mature = tier === 'mature';
  const canopyY = young ? 170 : mature ? 84 : 124;
  let out = '<g data-botanical="rounded-young-tree">';
  out += stem(`M120 330 C120 282 118 241 120 ${canopyY + 56}`, young ? 7 : 9, STEM_DARK);
  out += stem(`M120 ${canopyY + 74} C99 ${canopyY + 51} 85 ${canopyY + 33} 72 ${canopyY + 25}`, 3, STEM);
  out += stem(`M120 ${canopyY + 65} C141 ${canopyY + 42} 158 ${canopyY + 26} ${mature ? 177 : 166} ${canopyY + 20}`, 3, STEM);
  const canopy = young
    ? 'M120 211 C94 215 75 201 76 180 C67 163 83 145 103 146 C113 128 137 130 146 147 C169 143 184 161 175 180 C175 204 150 215 120 211Z'
    : mature
      ? 'M120 187 C91 192 66 176 68 150 C52 132 69 102 96 105 C102 75 137 69 151 99 C180 91 201 115 190 141 C205 163 171 191 145 186 C137 193 128 192 120 187Z'
      : 'M120 194 C96 198 78 185 79 164 C67 146 82 122 104 124 C111 101 138 100 149 123 C173 118 188 138 180 159 C191 177 161 199 139 191 C132 197 126 198 120 194Z';
  out += `<path d="${canopy}" fill="${accent}" fill-opacity="${mature ? 0.88 : 0.8}" stroke="${STEM}" stroke-width="1.7" stroke-linejoin="round"/>`;
  out += `<path d="${young ? 'M98 183 C109 169 125 164 144 167 C149 178 141 190 123 193 C112 192 103 189 98 183Z' : mature ? 'M84 154 C93 124 122 105 153 113 C176 123 180 146 163 164 C139 179 108 175 84 154Z' : 'M91 164 C102 137 129 124 155 133 C171 143 170 163 153 174 C131 185 107 180 91 164Z'}" fill="${SAGE}" fill-opacity=".48"/>`;
  out += leafDetail(`M${young ? 104 : 88} ${canopyY + 46} C120 ${canopyY + 12} 143 ${canopyY + 5} ${mature ? 176 : 160} ${canopyY + 32}`, 0.34);
  out += `<path d="M90 315 C104 306 137 306 151 315 C139 329 103 329 90 315Z" fill="${SAGE_LIGHT}" fill-opacity=".3"/>`;
  return `${out}</g>`;
}

function renderSleeping(index, accent) {
  let out = '<g data-botanical="sleeping-droop">';
  if (index === 0) {
    out += stem('M120 330 C119 300 113 276 101 254 C84 226 64 220 46 223', 4.6, STEM_DARK);
    out += leaf('M96 266 C76 270 59 263 50 249 C66 242 84 247 98 257 C101 261 100 264 96 266Z', accent, 0.58, leafDetail('M95 262 C78 257 66 252 55 248'));
    out += leaf('M72 232 C59 232 47 226 42 216 C54 211 67 216 75 225 C76 229 75 231 72 232Z', accent, 0.45, leafDetail('M71 228 C60 224 53 220 46 216'));
  } else if (index === 1) {
    out += stem('M120 330 C121 298 117 271 104 249 C91 227 79 212 62 201', 4, STEM_DARK);
    out += stem('M104 250 C85 246 69 238 56 224', 1.9, STEM);
    out += leaflet(88, 238, -164, 0.7, accent, 0.5);
    out += leaflet(76, 226, -168, 0.62, accent, 0.46);
    out += leaflet(94, 242, 11, 0.62, accent, 0.46);
    out += leaflet(68, 216, -172, 0.54, accent, 0.42);
  } else if (index === 2) {
    out += stem('M120 330 C119 295 115 258 105 226 C98 203 91 187 74 178', 4, STEM_DARK);
    out += stem('M105 226 C92 219 81 206 75 190', 2, STEM);
    out += flowerHead(74, 178, 0.58, accent, -32);
    out += leaf('M104 238 C91 239 80 232 76 223 C88 221 99 226 106 233 C107 236 106 238 104 238Z', accent, 0.46, leafDetail('M103 234 C92 231 84 227 78 223'));
  } else {
    out += stem('M120 330 C117 294 111 265 98 242 C86 221 70 213 55 214', 7, STEM_DARK);
    out += `<path d="M99 253 C80 258 62 250 54 235 C59 217 82 214 98 225 C107 234 107 244 99 253Z" fill="${accent}" fill-opacity=".56" stroke="${STEM}" stroke-width="1.4"/>`;
    out += `<path d="M82 242 C89 230 98 226 104 227" fill="none" stroke="${SAGE_LIGHT}" stroke-width="2" stroke-linecap="round" opacity=".5"/>`;
  }
  out += `<path d="M91 321 C103 315 137 315 149 321 C138 329 103 329 91 321Z" fill="${SAGE_LIGHT}" fill-opacity=".25"/>`;
  return `${out}</g>`;
}

function renderArchived(index, accent) {
  const branchSets = [
    [['M120 330 C118 292 119 254 122 218', 3.7], ['M121 266 C102 246 88 228 77 205', 2.2], ['M121 245 C141 223 154 204 163 180', 2.2]],
    [['M120 330 C119 291 120 251 116 220', 3.6], ['M118 269 C98 249 84 229 75 207', 2], ['M119 247 C137 223 143 200 146 174', 2], ['M117 234 C105 216 99 197 97 181', 1.8]],
    [['M120 330 C119 291 122 248 127 205', 3.4], ['M124 263 C103 241 91 219 86 193', 2.1], ['M126 242 C145 222 159 198 166 170', 2.1]],
    [['M120 330 C122 291 120 254 118 214', 5], ['M119 271 C99 246 83 224 66 204', 2.5], ['M120 255 C140 236 161 218 178 193', 2.5], ['M119 232 C106 212 102 194 102 171', 2]],
  ][index];
  let out = '<g data-botanical="archived-seed-heads">';
  for (const [path, width] of branchSets) out += stem(path, width, DRY_DARK, 0.92);
  const heads = index === 1
    ? [[75, 207, 0.9], [97, 181, 0.72], [146, 174, 0.85], [116, 220, 0.76]]
    : index === 3
      ? [[66, 204, 0.85], [102, 171, 0.76], [178, 193, 0.92], [118, 214, 0.68]]
      : [[77, 205, 0.9], [86, 193, 0.62], [163, 180, 0.9], [123, 218, 0.7]];
  for (const [x, y, scale] of heads) {
    out += `<g data-element="seed-head" transform="translate(${x} ${y}) scale(${scale})"><path d="M0 18 C-8 7 -8 -5 0 -14 C8 -5 8 7 0 18Z" fill="${DRY}" fill-opacity=".72" stroke="${DRY_DARK}" stroke-width="1.1"/><path d="M0 12 L0 -12 M-5 5 L-9 -1 M5 5 L9 -1" fill="none" stroke="${accent}" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/></g>`;
  }
  out += `<path d="M92 321 C105 315 136 315 148 321 C138 329 104 329 92 321Z" fill="${DRY}" fill-opacity=".24"/>`;
  return `${out}</g>`;
}
