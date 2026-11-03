import type { CatalogSelection, CustomRef, SlotValue } from './types';
import { imageFor } from './types';

export type Slots = Record<string, SlotValue>;

/** Generic, built-in style presets (our own text). The handraw 367-style
 *  library is NOT imported in v1, so these are not handraw data. */
export const STYLE_PRESETS: { id: string; label: string; fragment: string }[] = [
  { id: 'none', label: '无预设（跟随参考图）', fragment: '' },
  { id: 'photo', label: '写实人像写真', fragment: 'photorealistic portrait photography, natural skin texture, soft studio lighting' },
  { id: 'magazine', label: '日韩杂志画报', fragment: 'Korean/Japanese magazine editorial illustration, clean layout, fashionable' },
  { id: 'anime', label: '日系二次元插画', fragment: 'Japanese anime illustration, cel shading, clean line art' },
  { id: 'game', label: '2.5D 游戏原画立绘', fragment: '2.5D game splash art, detailed rendering, dynamic lighting' },
  { id: 'clay', label: '3D 潮玩手办质感', fragment: '3D designer toy figurine, soft vinyl texture, studio product shot' },
  { id: 'cyber', label: '赛博朋克霓虹', fragment: 'cyberpunk neon city atmosphere, glowing rim light' },
  { id: 'character-sheet', label: '角色设定集立绘（纯白底）', fragment: 'character design sheet, full body, plain white background' },
];

function descOf(value: SlotValue): string {
  if (!value) return '';
  if (value.kind === 'catalog') return value.item.description || value.item.name || value.item.id;
  return '';
}

function slotImage(value: SlotValue): string | null {
  if (!value) return null;
  if (value.kind === 'upload') return value.src;
  return imageFor(value.item, value.view, value.layer) || null;
}

/** Fixed assembly order, as specified for v1. */
export function assemblePrompt(slots: Slots, styleId: string, customRefs: CustomRef[]): string {
  const style = STYLE_PRESETS.find((s) => s.id === styleId);
  const parts: string[] = ['Create one coherent image that combines all the references below into a single scene.'];
  if (style?.fragment) parts.push(`Style: ${style.fragment}.`);
  const ordered: [string, string][] = [
    ['scene', 'Scene'], ['light', 'Lighting'], ['pose', 'Pose'],
    ['costume', 'Outfit'], ['furniture', 'Furniture'], ['prop', 'Props'],
    ['animal', 'Animal'],
  ];
  for (const [key, label] of ordered) {
    const d = descOf(slots[key]);
    if (d) parts.push(`${label}: ${d}.`);
  }
  const portrait = slots['portrait'];
  if (portrait?.kind === 'upload') {
    parts.push('Portrait: use the user-uploaded portrait as the face and head reference, keeping the person recognisable and consistent with it.');
  }
  if (customRefs.length) {
    parts.push(`Additional references (${customRefs.length}): incorporate each uploaded reference naturally into the same image.`);
  }
  return parts.join(' ');
}

export interface CollageItem {
  src: string;
  label: string;
}

export function collageItems(slots: Slots, customRefs: CustomRef[]): CollageItem[] {
  const out: CollageItem[] = [];
  const order = ['portrait', 'pose', 'costume', 'scene', 'furniture', 'prop', 'light', 'animal'];
  for (const key of order) {
    const src = slotImage(slots[key]);
    if (src) {
      const v = slots[key];
      out.push({ src, label: v?.kind === 'catalog' ? `${key}: ${(v as CatalogSelection).item.name}` : `${key}: uploaded portrait` });
    }
  }
  for (const r of customRefs) out.push({ src: r.src, label: `custom: ${r.name}` });
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load reference image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

/** Draw references in a grid and return a PNG data URL. Throws if a
 *  remote image taints the canvas (CORS) — callers surface that message
 *  and suggest uploading the file instead of pasting its URL. */
export async function exportCollage(items: CollageItem[]): Promise<string> {
  if (!items.length) throw new Error('No reference images selected for the collage.');
  const images = await Promise.all(items.map((i) => loadImage(i.src)));
  const cols = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / cols);
  const cell = 600;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    const scale = Math.min(cell / img.width, cell / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.font = '28px sans-serif';
    ctx.fillText(items[i].label.slice(0, 40), x + 12, y + 36);
  });
  return canvas.toDataURL('image/png');
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the uploaded file.'));
    r.readAsDataURL(blob);
  });
}

/** Fetch an image URL (same-origin catalog paths work; remote URLs may
 *  fail on CORS) and return a data URL, for sending to image APIs. */
export async function srcToDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not fetch reference image (${res.status}): ${src}`);
  return blobToDataUrl(await res.blob());
}
