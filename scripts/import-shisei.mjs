import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-shisei.mjs /path/to/shisei');
const root = path.resolve(source);
const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const exists = async (file) => stat(file).then((s) => s.isFile()).catch(() => false);
const result = [];
let copied = 0;
for (const pose of catalog) {
  const variants = {};
  for (const [layer, files] of Object.entries({line: pose.views, clay: pose.maps, depth: pose.maps, normal: pose.maps, photo: pose.photos})) {
    for (const [view, file] of Object.entries(files || {})) {
      if (!file || path.basename(file) !== file) continue;
      for (const size of layer === 'line' ? ['w300', 'w900'] : ['w900']) {
        const src = path.join(root, 'images', layer, size, file);
        if (!(await exists(src))) continue;
        const relative = `assets/${layer}/${size}/${file}`;
        await mkdir(path.dirname(relative), {recursive: true});
        await cp(src, relative);
        ((variants[view] ??= {})[layer] ??= {})[size] = relative;
        copied++;
      }
    }
  }
  if (Object.values(variants).some((v) => v.line?.w900)) result.push({id: pose.id, type: 'pose', name: pose.name_cn, names: {ja: pose.name_jp, en: pose.name_en, ko: pose.name_kr}, category: pose.class_cn, rating: pose.rating, series: pose.series, description: pose.desc_en || '', variants});
}
const costumeCatalog = JSON.parse(await readFile(path.join(root, 'data/costumes.json'), 'utf8'));
const costumeCategories = {HC:'中国历代',WE:'世界民族',MD:'现代',FM:'礼服',SP:'运动',WK:'职业与制服',WH:'西方历史',FN:'幻想',FS:'节日',IN:'家居泳装',AC:'配饰',LG:'性感内衣'};
for (const item of costumeCatalog.items) {
  const variants = {};
  for (const [view, file] of Object.entries(item.views || {})) {
    if (!file || path.basename(file) !== file) continue;
    for (const size of ['w300', 'w900']) {
      const src = path.join(root, 'images/costume/grey', size, file);
      if (!(await exists(src))) continue;
      const relative = `assets/costume/grey/${size}/${file}`;
      await mkdir(path.dirname(relative), {recursive: true});
      await cp(src, relative);
      ((variants[view] ??= {}).image ??= {})[size] = relative;
      copied++;
    }
  }
  if (Object.values(variants).some(v => v.image?.w900)) result.push({id:item.id, type:'costume', name:item.name_zh, names: {ja: item.name_ja, en: item.name_en, ko: item.name_ko}, category:costumeCategories[item.cat] || item.cat, rating:item.rating, description:item.desc_en || '', variants});
}
await writeFile('catalog.json', JSON.stringify(result));
console.log(`Imported ${result.length} items and ${copied} image files.`);
