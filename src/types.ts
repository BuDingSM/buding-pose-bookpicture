export type GalleryType = 'pose' | 'costume' | 'scene' | 'furniture' | 'prop' | 'light' | 'animal';

export interface CatalogItem {
  id: string;
  type: GalleryType | string;
  name: string;
  names?: Record<string, string>;
  category?: string;
  rating?: string;
  series?: string;
  description?: string;
  variants: Record<string, Record<string, Record<string, string>>>;
}

export const GALLERY_TYPES: { key: GalleryType; label: string }[] = [
  { key: 'pose', label: '姿势' },
  { key: 'costume', label: '服装' },
  { key: 'scene', label: '场景' },
  { key: 'furniture', label: '家具' },
  { key: 'prop', label: '道具' },
  { key: 'light', label: '光线' },
  { key: 'animal', label: '动物' },
];

export const VIEW_LABELS: Record<string, string> = {
  front: '正面', diag: '斜侧', side: '侧面', back: '背面', above: '俯视', below: '仰视', eye: '平视',
};
export const LAYER_LABELS: Record<string, string> = {
  line: '线稿', clay: '白模', depth: '深度图', normal: '法线图', photo: '实拍', image: '原图',
};

export const VIEW_ORDER = ['front', 'diag', 'side', 'back', 'above', 'below', 'eye'];
export const LAYER_ORDER = ['line', 'clay', 'depth', 'normal', 'photo', 'image'];

export function viewsOf(item: CatalogItem): string[] {
  return VIEW_ORDER.filter((v) => item.variants[v]);
}
export function layersOf(item: CatalogItem, view: string): string[] {
  return LAYER_ORDER.filter((l) => item.variants[view]?.[l]);
}
export function imageFor(item: CatalogItem, view: string, layer: string, size = 'w900'): string {
  const sizes = item.variants[view]?.[layer];
  return sizes?.[size] || sizes?.w900 || sizes?.w300 || '';
}
export function firstVariant(item: CatalogItem): { view: string; layer: string } {
  for (const v of viewsOf(item)) {
    const layers = layersOf(item, v);
    if (layers.length) return { view: v, layer: layers[0] };
  }
  return { view: 'front', layer: 'image' };
}

/** One studio slot value: either a catalog item or a user-supplied image. */
export interface CatalogSelection {
  kind: 'catalog';
  item: CatalogItem;
  view: string;
  layer: string;
}
export interface UploadSelection {
  kind: 'upload';
  src: string; // data URL or pasted URL
  name: string;
}
export type SlotValue = CatalogSelection | UploadSelection | null;

export interface CustomRef {
  id: string;
  src: string;
  name: string;
}

export interface Settings {
  provider: 'gemini' | 'openai' | 'qwen' | 'doubao' | 'comfyui';
  model: string;
  apiKey: string;
  baseUrl: string; // used by ComfyUI; also editable endpoint for qwen/doubao
  workflowJson: string;
}

export const DEFAULT_MODELS: Record<Settings['provider'], string> = {
  gemini: 'gemini-2.5-flash-image',
  openai: 'gpt-image-1',
  qwen: 'qwen-image-edit-plus',
  doubao: 'doubao-seedream-4-5-251128',
  comfyui: '',
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  model: DEFAULT_MODELS.gemini,
  apiKey: '',
  baseUrl: 'http://127.0.0.1:8188',
  workflowJson: '',
};

export interface HistoryEntry {
  id: string;
  at: string;
  provider: string;
  model: string;
  prompt: string;
  image?: string; // data URL or result URL
  error?: string;
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
