import { plantSvg, growthProfile } from './plants.js';

/** Render the same botanical specimens as the scene, without screen animations. */
export async function gardenPng(projects, now = Date.now()) {
  const columns = Math.min(projects.length > 25 ? 8 : 5, Math.max(1, projects.length));
  const rows = Math.max(1, Math.ceil(projects.length / columns));
  const width = projects.length > 25 ? 1920 : 1440;
  const rowHeight = 350;
  const height = 230 + rows * rowHeight + 75;
  if (height > 32000) throw new Error('сад слишком большой для одного изображения. сохраните его в json или выберите часть через фильтр.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('рисование недоступно в этом браузере.');
  await document.fonts?.ready;
  ctx.fillStyle = '#f4f1e9';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fcfaf4';
  ctx.fillRect(35, 35, width - 70, height - 70);
  ctx.strokeStyle = '#d9d9ca';
  ctx.strokeRect(35, 35, width - 70, height - 70);
  ctx.fillStyle = '#53694f';
  ctx.font = '500 24px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('project garden', 70, 85);
  ctx.fillStyle = '#303d30';
  ctx.font = '500 64px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('сад проектов', 70, 154);
  ctx.fillStyle = '#727668';
  ctx.font = '12px "Golos Text", sans-serif';
  const plantWord = { one: 'растение', few: 'растения', many: 'растений', other: 'растения' }[new Intl.PluralRules('ru').select(projects.length)];
  ctx.fillText(`${projects.length} ${plantWord} · ${new Date(now).toLocaleDateString('ru-RU')}`, 73, 186);
  const cellWidth = (width - 140) / columns;
  for (let row = 0; row < rows; row += 1) {
    const baseline = 230 + row * rowHeight + 247;
    ctx.strokeStyle = '#aea891';
    ctx.beginPath();
    ctx.moveTo(70, baseline);
    ctx.lineTo(width - 70, baseline);
    ctx.stroke();
    ctx.fillStyle = '#e5dfcf';
    ctx.fillRect(70, baseline + 1, width - 140, 10);
  }
  // Sequential images keep memory bounded for large gardens.
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    const growth = growthProfile(project, now);
    const x = 70 + cellWidth * (index % columns + .5);
    const top = 230 + Math.floor(index / columns) * rowHeight;
    const svg = plantSvg(project, false, now).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" ');
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('не удалось нарисовать растение.'));
        image.src = url;
      });
      ctx.drawImage(image, x - 90, top, 180, 255);
    } finally {
      URL.revokeObjectURL(url);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#303d30';
    ctx.font = '500 23px "Cormorant Garamond", Georgia, serif';
    const name = project.name || 'без названия';
    const limit = cellWidth - 22;
    let label = name;
    while (ctx.measureText(label).width > limit && label.length > 1) label = label.slice(0, -1);
    if (label !== name) label = `${label.slice(0, -1)}…`;
    ctx.fillText(label, x, top + 285);
    ctx.fillStyle = '#727668';
    ctx.font = '10px "Golos Text", sans-serif';
    ctx.fillText(project.status === 'archived' ? 'гербарий' : project.status === 'sleeping' ? 'на паузе' : growth.label, x, top + 308);
    ctx.fillText(`${growth.speciesLabel} · ${Math.floor(growth.days)} дн. роста`, x, top + 325);
  }
  if (!projects.length) {
    ctx.textAlign = 'center';
    ctx.font = 'italic 32px "Cormorant Garamond", Georgia, serif';
    ctx.fillText('здесь начнётся новый сад', width / 2, 370);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#727668';
  ctx.font = 'italic 20px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('у каждого проекта своё место', 70, height - 60);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('браузер не смог сохранить изображение.')), 'image/png'));
}
