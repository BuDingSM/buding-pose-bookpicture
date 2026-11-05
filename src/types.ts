export interface CatalogItem {
  id: string;
  type: string;
  name: string;
  names?: Record<string, string | null>;
  category?: string;
  series?: string;
  rating?: string;
  description?: string;
  source?: string;
  variants: Record<string, Record<string, Record<string, string>>>;
  /** User-uploaded image (studio only): a data URL, not a server path. */
  dataUrl?: string;
}

export const VIEW_ORDER = ['front', 'eye', 'diag', 'side', 'back', 'above', 'below'];

/** Display layer preference: line art first (pose default is line + front). */
export const LAYER_ORDER = ['line', 'image', 'clay', 'photo', 'depth', 'normal', 'grey', 'plain'];

export function viewsOf(item: CatalogItem): string[] {
  return VIEW_ORDER.filter((v) => item.variants[v]);
}

export function layersOf(item: CatalogItem, view: string): string[] {
  const keys = Object.keys(item.variants[view] || {});
  return [...keys].sort((a, b) => {
    const ia = LAYER_ORDER.indexOf(a);
    const ib = LAYER_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

export function preferredLayer(item: CatalogItem, view: string): string {
  return layersOf(item, view)[0] || 'image';
}

/** Thumbnail: front first, line layer first, w300 > orig > w900 > any. */
export function thumbOf(item: CatalogItem): string {
  if (item.dataUrl) return item.dataUrl;
  for (const v of viewsOf(item)) {
    for (const l of layersOf(item, v)) {
      const s = item.variants[v][l];
      if (s?.w300) return '/' + s.w300;
      if (s?.orig) return '/' + s.orig;
      if (s?.w900) return '/' + s.w900;
      const any = Object.values(s || {})[0];
      if (any) return '/' + any;
    }
  }
  return '';
}

/** Grid card image: w900 tier when it exists, else w300. Never orig (face orig PNGs are ~2 MB). */
export function gridThumbOf(item: CatalogItem): string {
  for (const v of viewsOf(item)) {
    for (const l of layersOf(item, v)) {
      const s = item.variants[v][l];
      if (s?.w900) return '/' + s.w900;
      if (s?.w300) return '/' + s.w300;
    }
  }
  return thumbOf(item);
}

/** Modal view-thumbnail image: w900 when present, else w300, else orig. */
export function primaryLayer(item: CatalogItem): string {
  const counts = new Map<string, number>();
  for (const v of Object.values(item.variants)) {
    for (const l of Object.keys(v)) counts.set(l, (counts.get(l) || 0) + 1);
  }
  let best = 'image'; let bestN = -1;
  for (const l of LAYER_ORDER) {
    const n = counts.get(l) || 0;
    if (n > bestN) { best = l; bestN = n; }
  }
  return best;
}
export function viewThumbOf(item: CatalogItem, view: string, layer?: string): string {
  const l = layer && item.variants[view]?.[layer] ? layer : preferredLayer(item, view);
  const s = item.variants[view]?.[l];
  if (!s) return thumbOf(item);
  return '/' + (s.w900 || s.w300 || s.orig || Object.values(s)[0] || '');
}

export function bestImageOf(item: CatalogItem): string {
  if (item.dataUrl) return item.dataUrl;
  for (const tier of ['orig', 'w900', 'w300'] as const) {
    for (const v of viewsOf(item)) {
      for (const l of layersOf(item, v)) {
        const p = item.variants[v]?.[l]?.[tier];
        if (p) return '/' + p;
      }
    }
  }
  return thumbOf(item);
}

export function origImageOf(item: CatalogItem, view: string, layer: string): string {
  if (item.dataUrl) return item.dataUrl;
  const s = item.variants[view]?.[layer];
  if (s?.orig) return '/' + s.orig;
  return imageFor(item, view, layer);
}
export function imageFor(item: CatalogItem, view: string, layer: string): string {
  const s = item.variants[view]?.[layer];
  if (!s) return thumbOf(item);
  return '/' + (s.w900 || s.orig || s.w300 || Object.values(s)[0] || '');
}

export interface Settings {
  provider: 'gemini' | 'openai' | 'qwen' | 'doubao' | 'comfyui';
  model: string;
  apiKey: string;
  baseUrl: string;
  workflowJson: string;
}

export const DEFAULT_MODELS: Record<Settings['provider'], string> = {
  gemini: 'gemini-2.5-flash-image',
  openai: 'gpt-image-1',
  qwen: 'qwen-image-edit-plus',
  doubao: 'doubao-seedream-4-5-251128',
  comfyui: '',
};

export const PROVIDER_BASE_URLS: Record<Settings['provider'], string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  comfyui: 'http://127.0.0.1:8188',
};

/** Empty baseUrl means "use the provider default" (like Cherry Studio / LobeChat:
 * built-in providers ship with a preset address, only a proxy / local service
 * needs a manual address). */
export const DEFAULT_SETTINGS: Settings = {
  provider: 'qwen',
  model: DEFAULT_MODELS.qwen,
  apiKey: '',
  baseUrl: '',
  workflowJson: '',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pb-settings');
    const merged = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    // Migrate old defaults: the ComfyUI local address was once the global
    // default, so vendor providers saved with it must not keep showing it.
    if (merged.provider !== 'comfyui' && merged.baseUrl === 'http://127.0.0.1:8188') merged.baseUrl = '';
    try {
      if (!localStorage.getItem('pb-provider-settings')) {
        localStorage.setItem('pb-provider-settings', JSON.stringify({
          [merged.provider]: { model: merged.model, apiKey: merged.apiKey, baseUrl: merged.baseUrl, workflowJson: merged.workflowJson },
        }));
      }
    } catch { /* private mode */ }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('pb-settings', JSON.stringify(s));
  } catch { /* private mode */ }
}

/** Per-provider configs (localStorage 'pb-provider-settings'):
 * each provider keeps its own model / baseUrl / key / workflow, so
 * switching providers never wipes another provider's config. */
export interface ProviderConfig { model: string; apiKey: string; baseUrl: string; workflowJson: string }
export type ProviderMap = Partial<Record<Settings['provider'], ProviderConfig>>;

export function getProviderMap(): ProviderMap {
  try {
    const raw = localStorage.getItem('pb-provider-settings');
    return raw ? (JSON.parse(raw) as ProviderMap) : {};
  } catch { return {}; }
}

export function saveProviderConfig(provider: Settings['provider'], s: Settings) {
  try {
    const map = getProviderMap();
    map[provider] = { model: s.model, apiKey: s.apiKey, baseUrl: s.baseUrl, workflowJson: s.workflowJson };
    localStorage.setItem('pb-provider-settings', JSON.stringify(map));
  } catch { /* private mode */ }
}

export function configForProvider(provider: Settings['provider']): Settings {
  const saved = getProviderMap()[provider];
  const cfg: Settings = saved
    ? { provider, model: saved.model, apiKey: saved.apiKey, baseUrl: saved.baseUrl, workflowJson: saved.workflowJson || '' }
    : { provider, model: DEFAULT_MODELS[provider], apiKey: '', baseUrl: '', workflowJson: '' };
  if (provider !== 'comfyui' && cfg.baseUrl === 'http://127.0.0.1:8188') cfg.baseUrl = '';
  return cfg;
}

/** Switch providers: stash the current config under its own provider,
 * then return the target provider's saved config (or its defaults). */
export function switchProvider(current: Settings, provider: Settings['provider']): Settings {
  if (current.provider !== provider) saveProviderConfig(current.provider, current);
  return configForProvider(provider);
}
