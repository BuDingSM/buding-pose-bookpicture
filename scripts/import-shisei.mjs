// Draft only — not pushed to buding-pose-bookpicture.
// Generalises that repo's scripts/import-shisei.mjs (pose + costume only)
// to all seven Shisei libraries, into the pose-book catalog.json shape:
//   { id, type, name, names, category, rating, description, variants }
// where variants[view][layer][size] = relative path.
// Pose layers stay line/clay/depth/normal/photo; the other libraries
// have a single 'image' layer (grey tier for costume/prop/furniture,
// plain tier for scene/light/animal), so the existing app.js
// imageFor()/layersOf() logic can render them without a format change.
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node import-all-shisei.mjs /path/to/shisei');
const root = path.resolve(source);
const exists = async (f) => stat(f).then((s) => s.isFile()).catch(() => false);
const result = [];
let copied = 0;

async function copyItem({ type, item, views, layerDir, category, name, names }) {
  const variants = {};
  for (const [view, file] of Object.entries(views || {})) {
    if (!file || path.basename(file) !== file) continue;
    for (const size of ['w300', 'w900']) {
      const src = path.join(root, 'images', layerDir, size, file);
      if (!(await exists(src))) continue;
      const relative = `assets/${layerDir}/${size}/${file}`;
      await mkdir(path.dirname(relative), { recursive: true });
      await cp(src, relative);
      ((variants[view] ??= {}).image ??= {})[size] = relative;
      copied++;
    }
  }
  if (Object.values(variants).some((v) => v.image?.w900)) {
    result.push({ id: item.id, type, name, names, category, rating: item.rating, description: item.desc_en || '', variants });
  }
}

// Poses: keep the existing pose-book behaviour verbatim (see that repo).
const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
for (const pose of catalog) {
  const variants = {};
  for (const [layer, files] of Object.entries({ line: pose.views, clay: pose.maps, depth: pose.maps, normal: pose.maps, photo: pose.photos })) {
    for (const [view, file] of Object.entries(files || {})) {
      if (!file || path.basename(file) !== file) continue;
      for (const size of layer === 'line' ? ['w300', 'w900'] : ['w900']) {
        const src = path.join(root, 'images', layer, size, file);
        if (!(await exists(src))) continue;
        const relative = `assets/${layer}/${size}/${file}`;
        await mkdir(path.dirname(relative), { recursive: true });
        await cp(src, relative);
        ((variants[view] ??= {})[layer] ??= {})[size] = relative;
        copied++;
      }
    }
  }
  if (Object.values(variants).some((v) => v.line?.w900)) {
    result.push({ id: pose.id, type: 'pose', name: pose.name_cn, names: { ja: pose.name_jp, en: pose.name_en, ko: pose.name_kr }, category: pose.class_cn, rating: pose.rating, series: pose.series, description: pose.desc_en || '', variants });
  }
}

// Costumes: existing behaviour (grey tier, 12 Chinese categories).
const costumeCategories = { HC: '中国历代', WE: '世界民族', MD: '现代', FM: '礼服', SP: '运动', WK: '职业与制服', WH: '西方历史', FN: '幻想', FS: '节日', IN: '家居泳装', AC: '配饰', LG: '性感内衣' };
const costumeCatalog = JSON.parse(await readFile(path.join(root, 'data/costumes.json'), 'utf8'));
for (const item of costumeCatalog.items) {
  await copyItem({ type: 'costume', item, views: item.views, layerDir: 'costume/grey', category: costumeCategories[item.cat] || item.cat, name: item.name_zh, names: { ja: item.name_ja, en: item.name_en, ko: item.name_ko } });
}

// The five libraries the current import drops. Verified 2026-11-03 from
// upstream data: scenes 68, props 36, furniture 48, lights 55, animals 115.
// Views: scene eye/above/below; prop front/back/side/diag;
// furniture +above; light front/diag/side; animal front/diag/side/above/below.
const extra = [
  ['scene', 'scenes.json', 'scene/plain', (i) => i.group_zh || i.cat],
  ['prop', 'props.json', 'prop/grey', (i) => i.group_zh || i.cat],
  ['furniture', 'furniture.json', 'furniture/grey', (i) => i.group_zh || i.cat],
  ['light', 'lights.json', 'light/plain', (i) => i.group_zh || i.cat],
  ['animal', 'animals.json', 'animal/plain', (i) => i.group_zh || i.cat],
];
for (const [type, file, layerDir, categoryOf] of extra) {
  const lib = JSON.parse(await readFile(path.join(root, 'data', file), 'utf8'));
  for (const item of lib.items) {
    await copyItem({ type, item, views: item.views, layerDir, category: categoryOf(item), name: item.name_zh, names: { ja: item.name_ja, en: item.name_en, ko: item.name_ko } });
  }
}

await writeFile('catalog.json', JSON.stringify(result));
console.log(`Imported ${result.length} items and ${copied} image files.`);
console.log(Object.entries(result.reduce((a, x) => { a[x.type] = (a[x.type] || 0) + 1; return a; }, {})).map(([k, v]) => `${k}=${v}`).join(' '));
