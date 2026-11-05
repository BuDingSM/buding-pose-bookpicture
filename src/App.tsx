import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Armchair, ArrowLeft, Cat, ChevronDown, ChevronRight, ChevronUp, Copy, Download, Eye, EyeOff, Guitar, History, Image as ImageIcon, Key, Menu, Moon, Trash2, Upload,
  PersonStanding, Plus, Repeat, Search, Settings as SettingsIcon, Shirt, ShoppingBasket, Sparkles, Star, Sun, User, X,
} from 'lucide-react';
import type { CatalogItem, Settings } from './types';
import { PROVIDER_BASE_URLS, bestImageOf, imageFor, layersOf, origImageOf, primaryLayer, loadSettings, preferredLayer, saveProviderConfig, saveSettings, switchProvider, thumbOf, viewThumbOf, viewsOf } from './types';
import { generateImage, generateViaBackend } from './generate';
import type { Lang } from './i18n';
import { CAT_LABEL, CHIP_LABEL, LAYER_LABEL, SUB_LABEL, VIEW_LABEL, itemName, labelOf, tr } from './i18n';

type TopId = 'character' | 'pose' | 'costume' | 'scene' | 'furniture' | 'prop' | 'light' | 'animal' | 'favorites' | 'history' | 'stats';

interface Sub { id: string; key: string; match: (it: CatalogItem) => boolean }
interface Cat { id: TopId; icon: React.ReactNode; file?: string; subs?: Sub[]; chip: (it: CatalogItem) => string }

const CATS: Cat[] = [
  { id: 'character', icon: <User size={18} />, file: 'character.json',
    subs: [
      { id: 'face', key: 'face', match: (it) => it.category === '人脸' },
      { id: 'styling', key: 'styling', match: (it) => it.category === '人物造型' },
    ],
    chip: (it) => it.series || it.category || '' },
  { id: 'pose', icon: <PersonStanding size={18} />, file: 'pose.json', chip: (it) => it.category || '' },
  { id: 'costume', icon: <Shirt size={18} />, file: 'costume.json',
    subs: [
      { id: 'real', key: 'real', match: (it) => it.source !== 'costume-anime' },
      { id: 'anime', key: 'anime', match: (it) => it.source === 'costume-anime' },
    ],
    chip: (it) => it.category || '' },
  { id: 'scene', icon: <ImageIcon size={18} />, file: 'scene.json', chip: (it) => it.category || '' },
  { id: 'furniture', icon: <Armchair size={18} />, file: 'furniture.json', chip: (it) => it.category || '' },
  { id: 'prop', icon: <Guitar size={18} />, file: 'prop.json', chip: (it) => it.category || '' },
  { id: 'light', icon: <Sun size={18} />, file: 'light.json', chip: (it) => it.category || '' },
  { id: 'animal', icon: <Cat size={18} />, file: 'animal.json', chip: (it) => it.category || '' },
];

const PROMPT_ORDER: TopId[] = ['character', 'pose', 'costume', 'scene', 'light', 'furniture', 'prop', 'animal'];
const PAGE = 60;

function sourceInfo(it: CatalogItem): { author: string; site: string; url: string } {
  if (it.source === 'costume-anime') return { author: 'ギア', site: 'ai-costume-anime-gallery', url: 'https://ai-costume-anime-gallery.pages.dev/' };
  if (it.source === 'ai-portrait-gallery') return { author: 'あぎ', site: 'AI Portrait Gallery', url: 'https://ai-portrait-gallery.pages.dev/' };
  if (it.source === 'custom') return { author: 'omilic 自建', site: 'omilic', url: 'https://omilic.com/' };
  return { author: 'Shisei 项目', site: 'shisei.indaloop.app', url: 'https://shisei.indaloop.app/en/' };
}

interface HistoryItemRef { id: string; type: string; slot: string; dataUrl?: string; name?: string; description?: string }
interface HistoryEntry { id: number; at: string; items: HistoryItemRef[] }
interface SiteEngine { id: string; name: string; provider: string; pointsPerImage: number }

function loadHistory(): HistoryEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem('pb-history') || '[]');
    if (!Array.isArray(v)) return [];
    // History stores combos only: strip any result fields saved by older
    // builds (genStatus/genImage/genError) so old entries become plain combos.
    return v.filter((e) => e && Array.isArray(e.items)).map((e) => ({ id: e.id, at: e.at, items: e.items }));
  } catch { return []; }
}
function saveHistoryList(list: HistoryEntry[]) {
  // Newest first, so dropping from the end drops the oldest. Custom images
  // live in localStorage, which is small, so trim instead of losing everything.
  let arr = list.slice(0, 30);
  while (arr.length) {
    try { localStorage.setItem('pb-history', JSON.stringify(arr)); return; }
    catch {
      if (arr.length === 1) {
        // Last resort: keep the combo record, drop its uploaded images.
        try { localStorage.setItem('pb-history', JSON.stringify([{ ...arr[0], items: arr[0].items.map((r) => ({ id: r.id, type: r.type, slot: r.slot })) }])); return; }
        catch { /* fall through to empty */ }
      }
      arr = arr.slice(0, -1);
    }
  }
  try { localStorage.setItem('pb-history', '[]'); } catch { /* noop */ }
}

function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('pb-favs') || '[]')); } catch { return new Set(); }
}
function loadLang(): Lang {
  try {
    const v = localStorage.getItem('pb-lang');
    return v === 'zh-TW' || v === 'en' || v === 'ja' ? v : 'zh';
  } catch { return 'zh'; }
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('pb-theme') || 'light'; } catch { return 'light'; }
  });
  const [lang, setLang] = useState<Lang>(loadLang);
  const [top, setTop] = useState<TopId>(() => (typeof window !== 'undefined' && window.location.pathname.startsWith('/stats') ? 'stats' : 'pose'));
  const [adminPage, setAdminPage] = useState(() => (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')));
  const [sub, setSub] = useState<string>('real');
  const [chip, setChip] = useState('全部');
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [showSuggestive, setShowSuggestive] = useState(false);
  const [view, setView] = useState<'gallery' | 'studio'>('gallery');
  const [sideOpen, setSideOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [dView, setDView] = useState('');
  const [dLayer, setDLayer] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyResolved, setHistoryResolved] = useState<Map<number, CatalogItem[]>>(new Map());
  const [historyChecked, setHistoryChecked] = useState<Map<number, Set<string>>>(new Map());
  const [histExpanded, setHistExpanded] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(loadFavs);
  const [tray, setTray] = useState<Map<string, { item: CatalogItem; slot: string }>>(new Map());
  const [limit, setLimit] = useState(PAGE);
  const [genState, setGenState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [genImage, setGenImage] = useState('');
  // Bumped whenever a different combo is loaded, so a generation started
  // for the old combo can never overwrite the new combo's (empty) result.
  const genSession = useRef(0);
  // Site engines + points cards.
  const [siteEngines, setSiteEngines] = useState<SiteEngine[]>([]);
  const [engineSel, setEngineSel] = useState<string>(() => {
    try { return localStorage.getItem('pb-engine') || ''; } catch { return ''; }
  });
  const [cardKey, setCardKey] = useState<string>(() => {
    try { return localStorage.getItem('pb-card-key') || ''; } catch { return ''; }
  });
  const [cardInput, setCardInput] = useState('');
  const [cardBalance, setCardBalance] = useState<number | null>(null);
  const [cardLast4, setCardLast4] = useState('');
  const [cardBusy, setCardBusy] = useState(false);
  const [getCardOpen, setGetCardOpen] = useState(false);
  const siteEngine = engineSel.startsWith('site:') ? siteEngines.find((e) => e.id === engineSel.slice(5)) : undefined;
  // Admin.
  const [adminToken, setAdminToken] = useState<string>(() => {
    try { return localStorage.getItem('pb-admin-token') || ''; } catch { return ''; }
  });
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [adminLoginErr, setAdminLoginErr] = useState(false);
  const [adminEngines, setAdminEngines] = useState<{ id: string; name: string; provider: string; baseUrl: string; model: string; pointsPerImage: number; enabled: boolean; hasKey: boolean }[]>([]);
  const [engineDraft, setEngineDraft] = useState<{ id?: string; name: string; provider: string; baseUrl: string; apiKey: string; model: string; pointsPerImage: number; enabled: boolean } | null>(null);
  const [adminCards, setAdminCards] = useState<{ id: string; last4: string; pointsInitial: number; balance: number; status: string; createdAt: string; note: string; lastUsedAt: string; usageCount: number; usage: { at: string; engineName: string; cost: number; balanceAfter: number; ok: boolean | string; refunded?: boolean }[] }[]>([]);
  const [newCards, setNewCards] = useState<{ key: string; points: number }[] | null>(null);
  const [cardGenPoints, setCardGenPoints] = useState(100);
  const [cardGenCount, setCardGenCount] = useState(1);
  const [cardGenNote, setCardGenNote] = useState('');
  const [usageOpen, setUsageOpen] = useState<Set<string>>(new Set());
  const [comboDl, setComboDl] = useState<'idle' | 'busy'>('idle');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadType, setUploadType] = useState<TopId>('character');
  const [uploadDesc, setUploadDesc] = useState('');
  const [resultType, setResultType] = useState<TopId>('character');
  const [statsData, setStatsData] = useState<{ events: Record<string, number>; items: { id: string; count: number; type: string }[]; days: Record<string, unknown>[] } | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [statsItems, setStatsItems] = useState<Map<string, CatalogItem>>(new Map());
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const [counts, setCounts] = useState<Record<string, { count: number; general: number; suggestive: number }>>({});
  const cache = useRef<Map<string, CatalogItem[]>>(new Map());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('pb-view-tracked')) {
        sessionStorage.setItem('pb-view-tracked', '1');
        track('view');
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname;
      if (p.startsWith('/admin')) { setAdminPage(true); }
      else {
        setAdminPage(false);
        if (p.startsWith('/stats')) { setTop('stats'); setView('gallery'); }
        else if (top === 'stats') { setTop('pose'); setView('gallery'); }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [top]);

  useEffect(() => {
    if (genState !== 'busy') return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [genState]);

  function selectEngine(sel: string) {
    setEngineSel(sel);
    try { localStorage.setItem('pb-engine', sel); } catch { /* noop */ }
    if (sel.startsWith('own:')) {
      const p = sel.slice(4) as Settings['provider'];
      if (p !== settings.provider) {
        const next = switchProvider(settings, p);
        setSettings(next); saveSettings(next); saveProviderConfig(p, next);
      }
    }
  }

  async function bindCard() {
    const key = cardInput.replace(/[\s-]/g, '').toUpperCase();
    if (!key || cardBusy) return;
    setCardBusy(true);
    try {
      const r = await fetch('/api/card/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const j = await r.json();
      if (!r.ok) { showToast(j.error === 'card_disabled' ? tr(lang, 'cardDisabled') : tr(lang, 'invalidCard'), 4000); return; }
      setCardKey(key); setCardBalance(j.balance); setCardLast4(j.last4); setCardInput('');
      try { localStorage.setItem('pb-card-key', key); } catch { /* noop */ }
      showToast(`${tr(lang, 'balance')} ${j.balance} ${tr(lang, 'points')}`);
    } catch {
      showToast(tr(lang, 'errNetwork'), 4000);
    } finally { setCardBusy(false); }
  }

  async function adminFetch(path: string, init?: RequestInit) {
    const r = await fetch(path, { ...(init || {}), headers: { ...(init?.headers || {}), 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` } });
    if (r.status === 401) {
      setAdminToken('');
      try { localStorage.removeItem('pb-admin-token'); } catch { /* noop */ }
    }
    return r;
  }

  async function loadAdminData() {
    try {
      const [e, c] = await Promise.all([adminFetch('/api/admin/engines'), adminFetch('/api/admin/cards')]);
      if (e.ok) setAdminEngines((await e.json()).engines || []);
      if (c.ok) setAdminCards((await c.json()).cards || []);
    } catch { /* noop */ }
  }

  async function adminLogin() {
    setAdminLoginErr(false);
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adminUser, password: adminPass }) });
      const j = await r.json();
      if (!r.ok) { setAdminLoginErr(true); return; }
      setAdminToken(j.token); setAdminPass('');
      try { localStorage.setItem('pb-admin-token', j.token); } catch { /* noop */ }
    } catch { setAdminLoginErr(true); }
  }

  // Load site engines once; default to the first one when nothing is saved.
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch('/api/engines').then((r) => r.json());
        const list: SiteEngine[] = Array.isArray(j.engines) ? j.engines : [];
        setSiteEngines(list);
        let saved = '';
        try { saved = localStorage.getItem('pb-engine') || ''; } catch { /* noop */ }
        if (!saved || (saved.startsWith('site:') && !list.some((e) => e.id === saved.slice(5)))) {
          const sel = list.length ? `site:${list[0].id}` : `own:${settings.provider}`;
          setEngineSel(sel);
          try { localStorage.setItem('pb-engine', sel); } catch { /* noop */ }
        }
      } catch { /* engines unavailable: own-key flow only */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check a saved card key on load; drop it if it no longer verifies.
  useEffect(() => {
    let saved = '';
    try { saved = localStorage.getItem('pb-card-key') || ''; } catch { /* noop */ }
    if (!saved) return;
    (async () => {
      try {
        const r = await fetch('/api/card/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: saved }) });
        const j = await r.json();
        if (r.ok) { setCardBalance(j.balance); setCardLast4(j.last4); }
        else {
          setCardKey('');
          try { localStorage.removeItem('pb-card-key'); } catch { /* noop */ }
        }
      } catch { /* offline: keep the key, balance unknown until next check */ }
    })();
  }, []);

  useEffect(() => {
    if (adminPage && adminToken) loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPage, adminToken]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pb-theme', theme); } catch { /* noop */ }
  }, [theme]);

  function toggleTheme(e: React.MouseEvent) {
    const next = theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };
    // NOTE: do NOT detach startViewTransition from document (bare vt() throws
    // "Illegal invocation" in Chrome, so the theme never changed at all).
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // flushSync so React renders the new theme inside the transition
      // callback; otherwise the new snapshot is still the old theme.
      const t = doc.startViewTransition(() => { flushSync(() => apply()); });
      t.ready.then(() => {
        const x = e.clientX;
        const y = e.clientY;
        const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => {});
    } else {
      apply();
    }
  }
  useEffect(() => {
    try { localStorage.setItem('pb-lang', lang); } catch { /* noop */ }
  }, [lang]);

  useEffect(() => {
    fetch('/catalog/index.json').then((r) => r.json()).then((idx: { type: string; count: number; general: number; suggestive: number }[]) => {
      const m: Record<string, { count: number; general: number; suggestive: number }> = {};
      idx.forEach((e) => { m[e.type] = e; });
      setCounts(m);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setItems([]);
    setLoading(true);
    async function load() {
      try {
        if (top === 'history') {
          if (!ctrl.signal.aborted) { setItems([]); setLoading(false); }
          return;
        }
        if (top === 'favorites') {
          const all: CatalogItem[] = [];
          for (const c of CATS) {
            if (!c.file) continue;
            if (!cache.current.has(c.file)) {
              const r = await fetch('/catalog/' + c.file, { signal: ctrl.signal });
              cache.current.set(c.file, await r.json());
            }
            all.push(...(cache.current.get(c.file) || []));
          }
          if (!ctrl.signal.aborted) setItems(all);
        } else {
          const cat = CATS.find((c) => c.id === top)!;
          if (cat.file && !cache.current.has(cat.file)) {
            const r = await fetch('/catalog/' + cat.file, { signal: ctrl.signal });
            cache.current.set(cat.file, await r.json());
          }
          if (!ctrl.signal.aborted) setItems(cache.current.get(cat.file!) || []);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error(e);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => ctrl.abort();
  }, [top]);

  const cat = CATS.find((c) => c.id === top);
  const subDef = cat?.subs?.find((s) => s.id === sub);

  const baseList = useMemo(() => {
    let list = items;
    if (top === 'favorites') {
      list = list.filter((it) => favs.has(it.id));
    } else if (subDef) {
      list = list.filter((it) => subDef.match(it));
    }
    if (!showSuggestive) list = list.filter((it) => it.rating !== 'suggestive');
    return list;
  }, [items, top, subDef, showSuggestive, favs]);

  const chips = useMemo(() => {
    if (top === 'favorites' || !cat) return ['全部'];
    const seen = new Set<string>();
    const out: string[] = [];
    baseList.forEach((it) => {
      const c = cat.chip(it);
      if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    });
    return ['全部', ...out];
  }, [baseList, cat, top]);

  const filtered = useMemo(() => {
    let list = baseList;
    if (top !== 'favorites' && cat && chip !== '全部') list = list.filter((it) => cat.chip(it) === chip);
    if (top === 'pose') list = [...list].sort((a, b) => ((a.series === 'duo' ? 1 : 0) - (b.series === 'duo' ? 1 : 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((it) => `${itemName(it, lang)} ${it.name} ${it.id} ${it.description || ''}`.toLowerCase().includes(q));
    return list;
  }, [baseList, chip, cat, query, top, lang]);

  const shown = filtered.slice(0, limit);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || filtered.length <= limit) return;
    const ob = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((prev) => Math.min(prev + PAGE, filtered.length));
    }, { rootMargin: '400px' });
    ob.observe(el);
    return () => ob.disconnect();
  }, [shown.length, filtered.length, limit]);

  useEffect(() => {
    if (top !== 'history') return;
    let cancelled = false;
    (async () => {
      const byId = new Map<string, CatalogItem>();
      for (const c of CATS) {
        if (!c.file) continue;
        if (!cache.current.has(c.file)) {
          try { cache.current.set(c.file, await fetch('/catalog/' + c.file).then((r) => r.json())); } catch { /* noop */ }
        }
        for (const it of cache.current.get(c.file) || []) byId.set(it.id, it);
      }
      if (cancelled) return;
      const resolved = new Map<number, CatalogItem[]>();
      const checked = new Map<number, Set<string>>();
      for (const e of history) {
        const items = e.items.map((r) => {
          if (r.dataUrl) {
            return { id: r.id, type: r.type, name: r.name || '', category: r.slot, description: r.description || '', variants: {}, dataUrl: r.dataUrl } as CatalogItem;
          }
          return byId.get(r.id);
        }).filter((x): x is CatalogItem => !!x)
          .sort((a, b) => PROMPT_ORDER.indexOf(a.type as TopId) - PROMPT_ORDER.indexOf(b.type as TopId));
        resolved.set(e.id, items);
        checked.set(e.id, new Set(items.map((it) => it.id)));
      }
      setHistoryResolved(resolved);
      setHistoryChecked(checked);
    })();
    return () => { cancelled = true; };
  }, [top, history]);

  useEffect(() => {
    if (top !== 'stats') return;
    let cancelled = false;
    (async () => {
      try {
        const st = await fetch('/api/stats').then((r) => { if (!r.ok) throw new Error('stats'); return r.json(); });
        const byId = new Map<string, CatalogItem>();
        for (const c of CATS) {
          if (!c.file) continue;
          if (!cache.current.has(c.file)) {
            try { cache.current.set(c.file, await fetch('/catalog/' + c.file).then((r) => r.json())); } catch { /* noop */ }
          }
          for (const it of cache.current.get(c.file) || []) byId.set(it.id, it);
        }
        if (cancelled) return;
        setStatsData(st); setStatsError(false); setStatsItems(byId);
      } catch {
        if (!cancelled) setStatsError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [top]);

  const statsByCat = useMemo(() => {
    if (!statsData) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const it of statsData.items) m.set(it.type, (m.get(it.type) || 0) + it.count);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [statsData]);
  const statsDaily = useMemo(() => {
    if (!statsData) return { days: [] as { day: string; total: number; gen: number }[], max: 1 };
    const days = statsData.days.slice(0, 14).map((d) => {
      const total = Object.entries(d).filter(([k, v]) => k !== 'day' && typeof v === 'number').reduce((a, [, v]) => a + (v as number), 0);
      return { day: String(d.day), total, gen: typeof d.generate === 'number' ? (d.generate as number) : 0 };
    });
    return { days, max: Math.max(1, ...days.map((d) => d.total)) };
  }, [statsData]);

  const trayItems = useMemo(() => {
    return [...tray.values()].sort((a, b) => PROMPT_ORDER.indexOf(a.item.type as TopId) - PROMPT_ORDER.indexOf(b.item.type as TopId));
  }, [tray]);

  const basePrompt = useMemo(() => {
    if (!trayItems.length) return '';
    return trayItems.map((t) => t.item.description || t.item.name).join(', ') + '.';
  }, [trayItems]);
  const [promptText, setPromptText] = useState('');
  useEffect(() => { setPromptText(basePrompt); }, [basePrompt]);

  function navTo(t: TopId, s?: string, chip = '全部') {
    setChipsExpanded(false);
    try {
      if (t === 'stats') window.history.pushState(null, '', '/stats');
      else if (window.location.pathname.startsWith('/admin')) window.history.pushState(null, '', '/');
    } catch { /* noop */ }
    setTop(t);
    const c = CATS.find((x) => x.id === t);
    setSub(s ?? (c?.subs ? c.subs[0].id : ''));
    setChip(chip);
    setLimit(PAGE);
    setView('gallery');
    setSideOpen(false);
  }

  // Swap a tray reference: jump to the gallery on that item's own category
  // and small category. Picking a new one there replaces it, since the tray
  // holds one pick per top-level type.
  function swapRef(t: { item: CatalogItem; slot: string }) {
    const c = CATS.find((x) => x.id === t.item.type);
    if (!c) return;
    const s = c.subs?.find((x) => x.match(t.item));
    // Custom/uploaded images have no real small category: land unfiltered.
    const chip = t.item.dataUrl ? '全部' : (c.chip(t.item) || '全部');
    navTo(t.item.type as TopId, s ? s.id : undefined, chip);
  }

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('pb-favs', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }

  function addToTray(it: CatalogItem, fromCat: Cat) {
    track('tray', it.id, it.type);
    const slot = fromCat.chip(it);
    // One pick per top-level type: a new pick in the same type replaces
    // the previous one, whatever its small category was.
    setTray((prev) => {
      const next = new Map(prev);
      next.set(it.type, { item: it, slot });
      return next;
    });
  }

  function saveCombo() {
    if (!tray.size) return false;
    const refs: HistoryItemRef[] = [...tray.values()].map((t) => t.item.dataUrl
      ? { id: t.item.id, type: t.item.type, slot: t.slot, dataUrl: t.item.dataUrl, name: t.item.name, description: t.item.description }
      : { id: t.item.id, type: t.item.type, slot: t.slot });
    const key = refs.map((r) => r.id).sort().join(',');
    setHistory((prev) => {
      if (prev.some((e) => e.items.map((r) => r.id).sort().join(',') === key)) return prev;
      const next = [{ id: Date.now(), at: new Date().toISOString(), items: refs }, ...prev].slice(0, 30);
      saveHistoryList(next);
      return next;
    });
    return true;
  }

  function applyHistory(entry: HistoryEntry, onlyChecked: boolean) {
    const resolved = historyResolved.get(entry.id) || [];
    const checked = historyChecked.get(entry.id);
    const picked = onlyChecked && checked ? resolved.filter((it) => checked.has(it.id)) : resolved;
    if (!picked.length) return;
    setTray((prev) => {
      const next = new Map(prev);
      for (const it of picked) {
        const c = CATS.find((x) => x.id === it.type);
        if (!c) continue;
        next.set(it.type, { item: it, slot: c.chip(it) });
      }
      return next;
    });
    // A new combo means the previous generation no longer applies: drop
    // its result now, and invalidate any generation still in flight.
    genSession.current += 1;
    setGenImage('');
    setGenState('idle');
    setTrayOpen(true);
  }

  function openDetail(it: CatalogItem) {
    track('detail', it.id, it.type);
    setDetail(it);
    const v = viewsOf(it)[0] || 'front';
    setDView(v);
    setDLayer(preferredLayer(it, v));
  }

  function stepDetail(dir: 1 | -1) {
    if (!detail) return;
    const idx = filtered.findIndex((it) => it.id === detail.id);
    if (idx === -1) return;
    const next = filtered[Math.min(Math.max(idx + dir, 0), filtered.length - 1)];
    if (next && next.id !== detail.id) openDetail(next);
  }
  function stepView(dir: 1 | -1) {
    if (!detail) return;
    const vs = viewsOf(detail);
    const idx = vs.indexOf(dView);
    const next = vs[Math.min(Math.max(idx + dir, 0), vs.length - 1)];
    if (next) { setDView(next); setDLayer(preferredLayer(detail, next)); }
  }
  function stepLayer() {
    if (!detail) return;
    const ls = layersOf(detail, dView);
    const idx = ls.indexOf(dLayer);
    setDLayer(ls[(idx + 1) % ls.length] || dLayer);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (detail) setDetail(null);
        else if (uploadOpen) setUploadOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (appSettingsOpen) setAppSettingsOpen(false);
        else if (sourcesOpen) setSourcesOpen(false);
        else if (getCardOpen) setGetCardOpen(false);
        else if (trayOpen) setTrayOpen(false);
        return;
      }
      if (!detail) return;
      if (e.key === 'ArrowLeft') stepView(-1);
      else if (e.key === 'ArrowRight') stepView(1);
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepDetail(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepDetail(1); }
      else if (e.key === 'l' || e.key === 'L') stepLayer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, dView, dLayer, filtered, uploadOpen, settingsOpen, appSettingsOpen, sourcesOpen, getCardOpen, trayOpen]);

  function track(event: string, itemId?: string, type?: string) {
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, itemId, type }),
        keepalive: true,
      }).catch(() => { /* analytics are best-effort */ });
    } catch { /* noop */ }
  }

  function translateGenError(msg: string, l: Lang): string {
    const m = msg.toLowerCase();
    if (m.includes('image generation is not enabled')) return tr(l, 'errGroupNoImage');
    if (m.includes('invalid api key') || m.includes('incorrect api key') || m.includes('invalid key') || m.includes('unauthorized') || m.includes('401')) return tr(l, 'errInvalidKey');
    if (m.includes('insufficient') || m.includes('balance') || m.includes('quota')) return tr(l, 'errBalance');
    if (m.includes('rate limit') || m.includes('429') || m.includes('too many requests')) return tr(l, 'errRateLimit');
    if (m.includes('queue')) return tr(l, 'errQueueFull');
    if (m.includes('model') && (m.includes('not found') || m.includes('does not exist') || m.includes('not exist'))) return tr(l, 'errModel');
    if (m.includes('timeout') || m.includes('timed out')) return tr(l, 'errTimeout');
    if (m.includes('fetch failed') || m.includes('failed to fetch') || m.includes('network') || m.includes('econn') || m.includes('und_err')) return tr(l, 'errNetwork');
    return tr(l, 'errGenerate');
  }

  function showToast(msg: string, ms = 2200) {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), ms);
  }

  async function copyText(s: string) {
    try { await navigator.clipboard.writeText(s); showToast(tr(lang, 'copied')); } catch { /* noop */ }
  }

  function clearAllCache() {
    if (!window.confirm(tr(lang, 'clearCacheConfirm'))) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('pb-')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* noop */ }
    window.location.reload();
  }

  async function addResultToTray() {
    if (!genImage) return;
    try {
      const dataUrl = genImage.startsWith('data:') ? genImage : await urlToDataUrl(genImage);
      const item: CatalogItem = {
        id: `custom-result-${Date.now()}`,
        type: resultType,
        name: tr(lang, 'generationResult'),
        category: tr(lang, 'customImage'),
        description: 'Use this generated image as a reference, preserving its character, outfit, scene and overall style.',
        variants: {},
        dataUrl,
      };
      setTray((prev) => {
        const next = new Map(prev);
        next.set(resultType, { item, slot: tr(lang, 'customImage') });
        return next;
      });
      showToast(tr(lang, 'addedAsReference'));
    } catch {
      showToast(tr(lang, 'resultFetchFailed'), 4000);
    }
  }

  async function downloadResult() {
    if (!genImage) return;
    track('download');
    try {
      if (genImage.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = genImage;
        a.download = `daxiang-result.${genImage.split(';')[0].split('/')[1] || 'png'}`;
        document.body.appendChild(a); a.click(); a.remove();
        return;
      }
      const res = await fetch(genImage);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'daxiang-result.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      window.open(genImage, '_blank');
    }
  }

  async function fileToDataUrlResized(file: File, maxSide = 1024): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('load')); img.src = url; });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
    } finally { URL.revokeObjectURL(url); }
  }

  async function confirmUpload() {
    if (!uploadFile) return;
    try {
      const dataUrl = await fileToDataUrlResized(uploadFile);
      const baseName = uploadFile.name.replace(/\.[^.]*$/, '') || tr(lang, 'customImage');
      const item: CatalogItem = {
        id: `custom-${Date.now()}`,
        type: uploadType,
        name: baseName,
        category: tr(lang, 'customImage'),
        description: uploadDesc.trim() || baseName,
        variants: {},
        dataUrl,
      };
      setTray((prev) => {
        const next = new Map(prev);
        next.set(uploadType, { item, slot: tr(lang, 'customImage') });
        return next;
      });
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadOpen(false); setUploadFile(null); setUploadPreview(''); setUploadDesc('');
      showToast(tr(lang, 'uploaded'));
    } catch {
      showToast(tr(lang, 'uploadFailed'), 4000);
    }
  }

  async function downloadCombo() {
    if (!trayItems.length || comboDl === 'busy') return;
    setComboDl('busy');
    try {
      for (const t of trayItems) {
        const src = bestImageOf(t.item);
        if (!src) continue;
        const ext = src.split('.').pop()?.split('?')[0] || 'png';
        const a = document.createElement('a');
        a.href = src;
        a.download = `${t.item.id}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 350));
      }
      setComboDl('idle');
      showToast(tr(lang, 'comboDownloaded'));
    } catch {
      setComboDl('idle');
      showToast(tr(lang, 'comboDownloadFailed'), 4000);
    }
  }

  async function generate() {
    if (!trayItems.length) return;
    if (siteEngine) {
      if (!cardKey) { showToast(tr(lang, 'bindFirst'), 4000); return; }
    } else if (!settings.apiKey && settings.provider !== 'comfyui') {
      const msg = tr(lang, 'noKeyError');
      setGenState('error');
      showToast(msg, 4000);
      return;
    }
    if (trayItems.some((t) => t.item.rating === 'suggestive')) {
      if (!window.confirm(tr(lang, 'genSuggestiveWarn'))) return;
    }
    // History stores the combo only, never the generated result: make sure
    // this combo is saved, and keep the result in this page session only
    // (genImage state) until refresh/close.
    saveCombo();
    track('generate', undefined, siteEngine ? 'site' : settings.provider);
    const session = ++genSession.current;
    setGenState('busy');
    try {
      const refs: string[] = [];
      for (const t of trayItems) refs.push(await urlToDataUrl(thumbOf(t.item)));
      if (siteEngine) {
        const r = await fetch('/api/site-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineId: siteEngine.id, cardKey, prompt: promptText, images: refs }) });
        const j = await r.json();
        if (!r.ok) {
          if (typeof j.balance === 'number') setCardBalance(j.balance);
          if (genSession.current === session) {
            setGenState('error');
            showToast(j.error === 'insufficient_balance' ? tr(lang, 'insufficientBalance')
              : j.error === 'invalid_card' ? tr(lang, 'invalidCard')
              : j.error === 'card_disabled' ? tr(lang, 'cardDisabled')
              : translateGenError(j.error || '', lang), 4000);
          }
          return;
        }
        if (typeof j.balance === 'number') setCardBalance(j.balance);
        if (genSession.current === session) {
          setGenImage(j.image);
          setGenState('done');
        }
      } else {
        const out = settings.provider === 'comfyui'
          ? await generateImage(settings, promptText, refs)
          : await generateViaBackend(settings, promptText, refs);
        if (genSession.current === session) {
          setGenImage(out);
          setGenState('done');
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Error';
      const msg = translateGenError(raw, lang);
      if (genSession.current === session) {
        setGenState('error');
        showToast(raw && raw !== msg ? `${msg}（${raw.slice(0, 100)}）` : msg, 4000);
      }
    }
  }

  const title = top === 'favorites' ? labelOf(CAT_LABEL, 'favorites', lang) : (subDef ? labelOf(SUB_LABEL, subDef.key, lang) : labelOf(CAT_LABEL, cat?.id || '', lang));
  const crumb = top === 'favorites' ? labelOf(CAT_LABEL, 'favorites', lang) : `${labelOf(CAT_LABEL, cat?.id || '', lang)}${subDef ? ' / ' + labelOf(SUB_LABEL, subDef.key, lang) : ''}`;
  const detailIdx = detail ? filtered.findIndex((it) => it.id === detail.id) : -1;
  const detailImg = detail && dView && dLayer ? imageFor(detail, dView, dLayer) : (detail ? thumbOf(detail) : '');

  if (adminPage) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>搭像 · {tr(lang, 'adminTitle')}</h1>
          <a href="/" className="modalbtn" style={{ textDecoration: 'none' }}>{tr(lang, 'backHome')}</a>
        </div>
              {!adminToken ? (
                <div className="wsbox" style={{ maxWidth: 420 }}>
                  <h1 style={{ marginTop: 0 }}>{tr(lang, 'adminLogin')}</h1>
                  <div className="field"><label>{tr(lang, 'username')}</label><input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} /></div>
                  <div className="field"><label>{tr(lang, 'password')}</label><input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') adminLogin(); }} /></div>
                  {adminLoginErr && <p className="note">{tr(lang, 'loginFailed')}</p>}
                  <button className="primary" onClick={adminLogin}>{tr(lang, 'login')}</button>
                </div>
              ) : (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ margin: 0 }}>{tr(lang, 'adminTitle')}</h1>
                    <button className="modalbtn" onClick={() => { setAdminToken(''); try { localStorage.removeItem('pb-admin-token'); } catch { /* noop */ } }}>{tr(lang, 'logout')}</button>
                  </div>
                  <h2>{tr(lang, 'engines')}</h2>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                    {adminEngines.map((en) => (
                      <div key={en.id} className="slot" style={{ marginBottom: 0 }}>
                        <span><b>{en.name}</b><span>{en.provider} · {en.model} · {en.pointsPerImage}{tr(lang, 'pointsPerImage')} · {en.enabled ? tr(lang, 'engineEnabled') : tr(lang, 'cardStatusDisabled')}{en.hasKey ? '' : ` · ${tr(lang, 'noKeySet')}`}</span></span>
                        <button className="modalbtn" onClick={() => setEngineDraft({ id: en.id, name: en.name, provider: en.provider, baseUrl: en.baseUrl, apiKey: '', model: en.model, pointsPerImage: en.pointsPerImage, enabled: en.enabled })}>{tr(lang, 'edit')}</button>
                        <button className="modalbtn danger" onClick={async () => { if (!window.confirm(`${tr(lang, 'deleteEngine')} ${en.name}?`)) return; await adminFetch('/api/admin/engines/remove', { method: 'POST', body: JSON.stringify({ id: en.id }) }); loadAdminData(); }}>{tr(lang, 'deleteEngine')}</button>
                      </div>
                    ))}
                    {!adminEngines.length && <p className="kv">{tr(lang, 'statsEmpty')}</p>}
                  </div>
                  <button className="modalbtn" style={{ marginBottom: 16 }} onClick={() => setEngineDraft({ name: '搭像生图引擎', provider: 'openai', baseUrl: '', apiKey: '', model: '', pointsPerImage: 10, enabled: true })}>{tr(lang, 'addEngine')}</button>
                  {engineDraft && (
                    <div className="wsbox" style={{ marginBottom: 20 }}>
                      <div className="field"><label>{tr(lang, 'engineName')}</label><input value={engineDraft.name} onChange={(e) => setEngineDraft({ ...engineDraft, name: e.target.value })} /></div>
                      <div className="field"><label>{tr(lang, 'provider')}</label>
                        <select value={engineDraft.provider} onChange={(e) => setEngineDraft({ ...engineDraft, provider: e.target.value })}>
                          <option value="openai">OpenAI</option>
                          <option value="qwen">阿里百炼 · Qwen</option>
                          <option value="gemini">Google Gemini</option>
                          <option value="doubao">火山引擎 · 豆包</option>
                        </select>
                      </div>
                      <div className="field"><label>{tr(lang, 'engineBaseUrl')}</label><input value={engineDraft.baseUrl} onChange={(e) => setEngineDraft({ ...engineDraft, baseUrl: e.target.value })} placeholder="https://" /></div>
                      <div className="field"><label>{tr(lang, 'engineKey')}</label><input type="password" value={engineDraft.apiKey} onChange={(e) => setEngineDraft({ ...engineDraft, apiKey: e.target.value })} placeholder={tr(lang, 'engineKeyHint')} /></div>
                      <div className="field"><label>{tr(lang, 'engineModel')}</label><input value={engineDraft.model} onChange={(e) => setEngineDraft({ ...engineDraft, model: e.target.value })} /></div>
                      <div className="field"><label>{tr(lang, 'pointsPerImageText')}</label><input type="number" value={engineDraft.pointsPerImage} onChange={(e) => setEngineDraft({ ...engineDraft, pointsPerImage: Number(e.target.value) })} /></div>
                      <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" checked={engineDraft.enabled} onChange={(e) => setEngineDraft({ ...engineDraft, enabled: e.target.checked })} />{tr(lang, 'engineEnabled')}</label>
                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="primary" onClick={async () => { const r = await adminFetch('/api/admin/engines/save', { method: 'POST', body: JSON.stringify(engineDraft) }); if (r.ok) { setEngineDraft(null); loadAdminData(); } else { const j = await r.json(); showToast(j.error || 'error', 4000); } }}>{tr(lang, 'saveEngine')}</button>
                        <button className="modalbtn" onClick={() => setEngineDraft(null)}>{tr(lang, 'cancel')}</button>
                      </div>
                    </div>
                  )}
                  <h2>{tr(lang, 'cardManage')}</h2>
                  <div className="wsbox" style={{ marginBottom: 16 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[50, 100, 200].map((p) => (
                        <button key={p} className={`modalbtn ${cardGenPoints === p ? 'primary' : ''}`} onClick={() => setCardGenPoints(p)}>{p}{tr(lang, 'points')}</button>
                      ))}
                      <input type="number" style={{ width: 110 }} value={cardGenPoints} onChange={(e) => setCardGenPoints(Number(e.target.value))} aria-label={tr(lang, 'points')} />
                      <input type="number" style={{ width: 80 }} value={cardGenCount} onChange={(e) => setCardGenCount(Number(e.target.value))} aria-label={tr(lang, 'cardCount')} />
                      <input style={{ flex: 1, minWidth: 120 }} value={cardGenNote} onChange={(e) => setCardGenNote(e.target.value)} placeholder={tr(lang, 'cardNote')} />
                      <button className="primary" onClick={async () => { const r = await adminFetch('/api/admin/cards/generate', { method: 'POST', body: JSON.stringify({ points: cardGenPoints, count: cardGenCount, note: cardGenNote }) }); const j = await r.json(); if (r.ok) { setNewCards(j.cards); loadAdminData(); } else showToast(j.error || 'error', 4000); }}>{tr(lang, 'genCards')}</button>
                    </div>
                    {newCards && (
                      <div style={{ marginTop: 12 }}>
                        <p className="note">{tr(lang, 'newCardsOnce')}</p>
                        {newCards.map((c) => (
                          <div key={c.key} className="row" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                            <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.key}</code>
                            <span>{c.points}{tr(lang, 'points')}</span>
                            <button className="modalbtn" onClick={() => copyText(c.key)}>{tr(lang, 'copyKey')}</button>
                          </div>
                        ))}
                        <button className="modalbtn" onClick={() => setNewCards(null)}>{tr(lang, 'close')}</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
                    {adminCards.map((c) => (
                      <div key={c.id} className="wsbox" style={{ marginBottom: 0 }}>
                        <div className="row" style={{ alignItems: 'center' }}>
                          <span><b>••••{c.last4}</b><span style={{ marginLeft: 8 }}>{tr(lang, 'balance')} {c.balance}/{c.pointsInitial}{tr(lang, 'points')} · {c.status === 'active' ? tr(lang, 'cardStatusActive') : tr(lang, 'cardStatusDisabled')}{c.note ? ` · ${c.note}` : ''}</span></span>
                          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button className="modalbtn" onClick={() => setUsageOpen((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{tr(lang, 'usageRecords')}（{c.usageCount}）</button>
                            <button className="modalbtn" onClick={async () => { await adminFetch('/api/admin/cards/status', { method: 'POST', body: JSON.stringify({ id: c.id, status: c.status === 'active' ? 'disabled' : 'active' }) }); loadAdminData(); }}>{c.status === 'active' ? tr(lang, 'disableCard') : tr(lang, 'enableCard')}</button>
                          </span>
                        </div>
                        {usageOpen.has(c.id) && (
                          <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                            {!c.usage.length && <p className="kv" style={{ margin: 0 }}>{tr(lang, 'noUsage')}</p>}
                            {c.usage.map((u, i) => (
                              <p key={i} className="kv" style={{ margin: 0 }}>{new Date(u.at).toLocaleString()} · {u.engineName} · -{u.cost}{tr(lang, 'points')} · {tr(lang, 'balance')} {u.balanceAfter}{u.ok === false ? (u.refunded ? ` · ${tr(lang, 'refunded')}` : ` · ${tr(lang, 'genFailed')}`) : ''}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
        </>
      )}
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <button className="iconbtn menu" onClick={() => setSideOpen(!sideOpen)} aria-label="Menu"><Menu size={18} /></button>
        <div className="logo"><ImageIcon size={20} /> 搭像<span className="logoslogan">先搭后画，一图成型</span></div>
        <div className="head-actions">
          <select className="langsel" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
            <option value="zh">中文</option>
            <option value="zh-TW">繁體</option>
            <option value="en">EN</option>
            <option value="ja">日</option>
          </select>
          <button className="iconbtn" onClick={toggleTheme} aria-label="Theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <button className="iconbtn head-btn" onClick={() => { setSettingsDraft(settings); setSettingsOpen(true); }} aria-label={tr(lang, 'apiSettings')}><Key size={18} /></button>
        <button className="iconbtn head-btn" onClick={() => setAppSettingsOpen(true)} aria-label={tr(lang, 'settings')}><SettingsIcon size={18} /></button>
      </header>

      <div className="layout">
        <aside className={`sidebar ${sideOpen ? 'open' : ''}`}>
          {CATS.map((c) => (
            <div key={c.id}>
              <button className={`navbtn ${top === c.id ? 'active' : ''}`} onClick={() => navTo(c.id)}>
                {c.icon}{labelOf(CAT_LABEL, c.id, lang)}<span className="count">{counts[c.id] ? (showSuggestive ? counts[c.id].count : counts[c.id].general) : ''}</span>
              </button>
              {c.subs && (
                <div className={`sub ${top === c.id ? 'open' : ''}`}>
                  <div className="sub-inner">
                    {c.subs.map((s) => (
                      <button key={s.id} className={`navbtn ${sub === s.id ? 'active' : ''}`} onClick={() => navTo(c.id, s.id)}>
                        <ChevronRight size={16} />{labelOf(SUB_LABEL, s.key, lang)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button className={`navbtn ${top === 'favorites' ? 'active' : ''}`} onClick={() => navTo('favorites')}>
            <Star size={18} />{labelOf(CAT_LABEL, 'favorites', lang)}<span className="count">{favs.size}</span>
          </button>
          <button className={`navbtn ${top === 'history' ? 'active' : ''}`} onClick={() => navTo('history')}>
            <History size={18} />{tr(lang, 'history')}<span className="count">{history.length}</span>
          </button>
          <div className="side-foot">
            <div className="note">{tr(lang, 'footerNote')}</div>
            <button className="sourcelink" onClick={() => setSourcesOpen(true)}>{tr(lang, 'attributionTitle')} →</button>
          </div>
        </aside>
        {sideOpen && <div className="side-backdrop" onClick={() => setSideOpen(false)} />}

        <main className="main">
          {view === 'gallery' && top === 'history' ? (
            <>
              <div className="crumb">{tr(lang, 'history')}</div>
              <h1>{tr(lang, 'history')}（{history.length}）</h1>
              {!history.length && <p className="kv">{tr(lang, 'historyEmpty')}</p>}
              <div style={{ display: 'grid' }}>
                {history.map((e) => {
                  const items = historyResolved.get(e.id) || [];
                  const checked = historyChecked.get(e.id) || new Set<string>();
                  const expanded = histExpanded.has(e.id);
                  const names = items.map((it) => itemName(it, lang)).join('、');
                  return (
                    <div key={e.id} className="hist-row">
                      <div className="hist-main" onClick={() => {
                        setHistExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                          return next;
                        });
                      }}>
                        <div className="hist-thumbs">
                          {items.slice(0, 8).map((it) => <img key={it.id} src={thumbOf(it)} alt="" />)}
                          {items.length > 8 && <span className="hist-more">+{items.length - 8}</span>}
                        </div>
                        <div className="hist-meta">
                          <span className="hist-date">{new Date(e.at).toLocaleString()}</span>
                          <span className="hist-sub">{items.length} {tr(lang, 'references')}</span>
                          <span className="hist-names">{names || tr(lang, 'historyEmpty')}</span>
                        </div>
                        <ChevronRight size={18} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', flexShrink: 0, color: 'var(--muted)' }} />
                        <button className="primary" style={{ padding: '7px 12px', flexShrink: 0 }} onClick={(ev) => { ev.stopPropagation(); applyHistory(e, false); }}>{tr(lang, 'applyAll')}</button>
                        <button className="iconbtn x" onClick={(ev) => {
                          ev.stopPropagation();
                          setHistory((prev) => { const next = prev.filter((x) => x.id !== e.id); saveHistoryList(next); return next; });
                        }}><X size={16} /></button>
                      </div>
                      {expanded && (
                        <div className="hist-pick">
                          {items.map((it) => (
                            <label key={it.id} className="hist-pick-item">
                              <input type="checkbox" checked={checked.has(it.id)} onChange={() => {
                                setHistoryChecked((prev) => {
                                  const next = new Map(prev);
                                  const set = new Set(next.get(e.id) || []);
                                  if (set.has(it.id)) set.delete(it.id); else set.add(it.id);
                                  next.set(e.id, set);
                                  return next;
                                });
                              }} />
                              <img src={thumbOf(it)} alt={itemName(it, lang)} />
                              <span>{labelOf(CAT_LABEL, it.type, lang)} · {itemName(it, lang)}</span>
                            </label>
                          ))}
                          <button className="modalbtn" disabled={!checked.size} onClick={() => applyHistory(e, true)}>{tr(lang, 'applySelected')}（{checked.size}）</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {history.length > 0 && (
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="modalbtn danger" onClick={() => { setHistory([]); saveHistoryList([]); }}>{tr(lang, 'clearHistory')}</button>
                </div>
              )}
            </>
                    ) : view === 'gallery' && top === 'stats' ? (
            <>
              <div className="crumb">{tr(lang, 'stats')}</div>
              <h1>{tr(lang, 'stats')}</h1>
              {statsError && <p className="note">{tr(lang, 'statsLoadFailed')}</p>}
              {!statsError && !statsData && <p className="kv">{tr(lang, 'loading')}</p>}
              {!statsError && statsData && !Object.values(statsData.events).some((v) => v > 0) && <p className="kv">{tr(lang, 'statsEmpty')}</p>}
              {!statsError && statsData && Object.values(statsData.events).some((v) => v > 0) && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {([['view', 'statsViews'], ['detail', 'statsDetail'], ['tray', 'statsTray'], ['generate', 'statsGenerate'], ['download', 'statsDownload']] as const).map(([ev, label]) => (
                      <div key={ev} className="wsbox" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 26, fontWeight: 700 }}>{statsData.events[ev] || 0}</div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr(lang, label)}</div>
                      </div>
                    ))}
                  </div>
                  {statsData.items.length > 0 && (
                    <>
                      <h3>{tr(lang, 'statsTopItems')}</h3>
                      <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
                        {statsData.items.slice(0, 20).map((it) => {
                          const resolved = statsItems.get(it.id);
                          return (
                            <div key={it.id} className="slot" style={{ marginBottom: 0 }}>
                              {resolved && <img src={thumbOf(resolved)} alt="" />}
                              <span><b>{resolved ? itemName(resolved, lang) : it.id}</b><span>{labelOf(CAT_LABEL, it.type, lang)}</span></span>
                              <b style={{ marginLeft: 'auto' }}>{it.count}</b>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {statsByCat.length > 0 && (
                    <>
                      <h3>{tr(lang, 'statsByCategory')}</h3>
                      <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
                        {statsByCat.map(([type, count]) => (
                          <div key={type} className="slot" style={{ marginBottom: 0 }}>
                            <span><b>{labelOf(CAT_LABEL, type, lang) || type}</b></span>
                            <b style={{ marginLeft: 'auto' }}>{count}</b>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {statsDaily.days.length > 0 && (
                    <>
                      <h3>{tr(lang, 'statsDaily')}</h3>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {statsDaily.days.map((d) => (
                          <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 13, width: 100, flexShrink: 0 }}>{d.day}</span>
                            <div style={{ flex: 1, height: 18, background: 'var(--panel2)', borderRadius: 99, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.round((d.total / statsDaily.max) * 100)}%`, height: '100%', background: 'var(--accent)' }} />
                            </div>
                            <span style={{ fontSize: 13, width: 60, textAlign: 'right' }}>{d.total}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          ) : view === 'gallery' ? (
            <>
              <div className="gallery-head">
                <div className="crumb">{crumb} · {loading ? '…' : filtered.length}</div>
                <div className="gallery-head-row">
                  <h1>{title}<span className="count-inline"> · {loading ? '…' : filtered.length}</span></h1>
                  <label className="gallery-search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr(lang, 'searchInCategory')} /></label>
                </div>
                <div className="chips-row">
                  <div className={`chips ${chipsExpanded ? '' : 'collapsed'}`}>
                    {chips.map((c) => (
                      <button key={c} className={`chip ${chip === c ? 'active' : ''}`} onClick={() => { setChip(c); setLimit(PAGE); }}>
                        {c === '全部' ? tr(lang, 'all') : labelOf(CHIP_LABEL, c, lang)}
                      </button>
                    ))}
                  </div>
                  <button className="chips-toggle" aria-label={chipsExpanded ? tr(lang, 'collapse') : tr(lang, 'expand')} onClick={() => setChipsExpanded(!chipsExpanded)}>
                    {chipsExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
              </div>
              {loading ? (<div className="grid">{Array.from({ length: 12 }).map((_, i) => (<div key={i} className="skel" />))}</div>) : (
                <>
                  <div className="grid">
                    {shown.map((it) => {
                      const fromCat = CATS.find((c) => c.id === it.type) || cat!;
                      return (
                        <button key={it.id} className="card" onClick={() => openDetail(it)}>
                          <span className={`fav ${favs.has(it.id) ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFav(it.id); }}>
                            <Star size={16} fill={favs.has(it.id) ? 'currentColor' : 'none'} />
                          </span>
                          <img src={thumbOf(it)} alt={itemName(it, lang)} loading="lazy" decoding="async" />
                          <span className="add" onClick={(e) => { e.stopPropagation(); addToTray(it, fromCat); }}>
                            <Plus size={16} />{tr(lang, 'addToTray')}
                          </span>
                          <span className="cardbody"><b>{itemName(it, lang)}</b><span>{labelOf(CHIP_LABEL, fromCat.chip(it), lang)}</span><span className="cardid">{it.id}</span></span>
                        </button>
                      );
                    })}
                  </div>
                  {!shown.length && <div className="empty">{tr(lang, 'noResults')}</div>}
                  {filtered.length > shown.length && (
                    <div ref={sentinelRef} className="sentinel">{tr(lang, 'loadMore')}（{filtered.length - shown.length} {tr(lang, 'remaining')}）</div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="crumb">{tr(lang, 'generationStudio')}</div>
              <h1>{tr(lang, 'generationStudio')}</h1>
              <div className="wsgrid">
                <div className="wsbox">
                  <h3>{tr(lang, 'references')} {trayItems.length ? `（${trayItems.length}）` : ''}</h3>
                  <div className="refs">
                    {trayItems.map((t) => (
                      <div key={t.item.id} className="ref">
                        <img src={thumbOf(t.item)} alt={itemName(t.item, lang)} />
                        <b>{itemName(t.item, lang)}</b><span>{labelOf(CAT_LABEL, t.item.type, lang)} · {labelOf(CHIP_LABEL, t.slot, lang)}</span>
                        <div className="refacts">
                          <button className="iconbtn" title={tr(lang, 'swapRef')} aria-label={tr(lang, 'swapRef')} onClick={() => swapRef(t)}><Repeat size={15} /></button>
                          <button className="iconbtn" title={tr(lang, 'removeRef')} aria-label={tr(lang, 'removeRef')} onClick={() => setTray((prev) => { const n = new Map(prev); n.delete(t.item.type); return n; })}><Trash2 size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!trayItems.length && <div className="empty">{tr(lang, 'trayEmpty')}</div>}
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="modalbtn" onClick={() => setUploadOpen(true)}><Upload size={16} />{tr(lang, 'uploadImage')}</button>
                    {trayItems.length > 0 && (
                      <button className="modalbtn" onClick={downloadCombo} disabled={comboDl === 'busy'}>{comboDl === 'busy' ? tr(lang, 'comboDownloading') : tr(lang, 'downloadCombo')}</button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="wsbox">
                  <h3>{tr(lang, 'prompt')}</h3>
                  <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} placeholder={tr(lang, 'prompt')} />
                  <div className="row" style={{ margin: '10px 0' }}>
                    <button className="modalbtn" onClick={() => copyText(promptText)}><Copy size={16} />{tr(lang, 'copyPrompt')}</button>
                    <button className="modalbtn" onClick={() => setPromptText(basePrompt)}>{tr(lang, 'resetPrompt')}</button>
                    <button className="modalbtn" onClick={() => setView('gallery')}><ArrowLeft size={16} />{tr(lang, 'backToGallery')}</button>
                  </div>
                  <div className="field">
                    <label>{tr(lang, 'engines')}</label>
                    <select value={engineSel} onChange={(e) => selectEngine(e.target.value)}>
                      {siteEngines.length > 0 && (
                        <optgroup label={tr(lang, 'siteEngineGroup')}>
                          {siteEngines.map((en) => (
                            <option key={en.id} value={`site:${en.id}`}>{en.name} · {en.pointsPerImage}{tr(lang, 'pointsPerImage')}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={tr(lang, 'ownKeyGroup')}>
                        <option value="own:qwen">阿里百炼 · Qwen</option>
                        <option value="own:gemini">Google Gemini</option>
                        <option value="own:openai">OpenAI</option>
                        <option value="own:doubao">火山引擎 · 豆包</option>
                        <option value="own:comfyui">ComfyUI</option>
                      </optgroup>
                    </select>
                  </div>
                  {siteEngine && (
                    <div className="field">
                      <label>{tr(lang, 'cardKey')}</label>
                      {cardKey ? (
                        <div className="row" style={{ alignItems: 'center' }}>
                          <span style={{ fontSize: 13 }}>{tr(lang, 'balance')} {cardBalance === null ? '…' : cardBalance} {tr(lang, 'points')} · ••••{cardLast4}</span>
                          <button className="modalbtn" style={{ marginLeft: 'auto' }} onClick={() => { setCardKey(''); setCardBalance(null); setCardLast4(''); try { localStorage.removeItem('pb-card-key'); } catch { /* noop */ } }}>{tr(lang, 'changeCard')}</button>
                        </div>
                      ) : (
                        <div className="row">
                          <input style={{ flex: 1 }} value={cardInput} onChange={(e) => setCardInput(e.target.value)} placeholder={tr(lang, 'cardKeyPlaceholder')} />
                          <button className="modalbtn" disabled={cardBusy || !cardInput.trim()} onClick={bindCard}>{tr(lang, 'bindCard')}</button>
                        </div>
                      )}
                      <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
                        <button className="modalbtn" onClick={() => setGetCardOpen(true)}>{tr(lang, 'howToGetCard')}</button>
                        {!cardKey && <span className="kv" style={{ margin: 0 }}>{tr(lang, 'bindFirst')}</span>}
                      </div>
                    </div>
                  )}
                  <button className="primary genbtn-form" style={{ width: '100%' }} onClick={generate} disabled={genState === 'busy' || (siteEngine ? (!cardKey || (cardBalance !== null && cardBalance < siteEngine.pointsPerImage)) : false)}>
                    <Sparkles size={18} />{genState === 'busy' ? tr(lang, 'generating') : siteEngine ? `${tr(lang, 'generateImage')} · ${siteEngine.pointsPerImage}${tr(lang, 'points')}` : tr(lang, 'generateImage')}
                  </button>
                  <p className="kv" style={{ marginTop: 8 }}>{tr(lang, 'footerNote')}</p>
                  {genState === 'busy' && <p className="kv" style={{ marginTop: 4 }}>{tr(lang, 'genLeaveNote')}</p>}
                  {!siteEngine && !settings.apiKey && settings.provider !== 'comfyui' && (
                    <p className="note" style={{ marginTop: 10 }}>{tr(lang, 'noKeyNote')}</p>
                  )}
                </div>
              {genImage && (
                <div className="wsbox" style={{ marginTop: 16 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>{tr(lang, 'generationResult')}</h3>
                    <button className="modalbtn" onClick={downloadResult}><Download size={16} />{tr(lang, 'downloadResult')}</button>
                  </div>
                  <p className="note" style={{ marginTop: 8 }}>{tr(lang, 'resultSessionOnly')}</p>
                  <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
                    <select value={resultType} onChange={(e) => setResultType(e.target.value as TopId)} style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', padding: '9px 10px' }} aria-label={tr(lang, 'uploadCategory')}>
                      {CATS.map((c) => (<option key={c.id} value={c.id}>{labelOf(CAT_LABEL, c.id, lang)}</option>))}
                    </select>
                    <button className="modalbtn" onClick={addResultToTray}><Plus size={16} />{tr(lang, 'useAsReference')}</button>
                  </div>
                  <img src={genImage} alt="result" style={{ width: '100%', maxWidth: 480, borderRadius: 12, marginTop: 12, display: 'block' }} />
                </div>
              )}
                </div>
              </div>
              <div className="genbar-mobile">
                <button className="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={generate} disabled={genState === 'busy' || (siteEngine ? (!cardKey || (cardBalance !== null && cardBalance < siteEngine.pointsPerImage)) : false)}>
                  <Sparkles size={18} />{genState === 'busy' ? tr(lang, 'generating') : siteEngine ? `${tr(lang, 'generateImage')} · ${siteEngine.pointsPerImage}${tr(lang, 'points')}` : tr(lang, 'generateImage')}
                </button>
              </div>

            </>
          )}
          <footer className="sitefoot">{tr(lang, 'footerNote')}</footer>
        </main>
      </div>

      <div className={view === 'studio' ? 'tray studio' : 'tray'}>
        <button className="traybtn" onClick={() => setTrayOpen(!trayOpen)}><ShoppingBasket size={18} />{tr(lang, 'tray')}<span className="n">{tray.size}</span></button>
      </div>
      {trayOpen && (
        <div className="traypanel open">
          <h3>{tr(lang, 'tray')}</h3>
          <div>
            {!tray.size && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{tr(lang, 'trayEmpty')}</p>}
            {[...tray.entries()].map(([key, t]) => (
              <div key={key} className="slot">
                <img src={thumbOf(t.item)} alt="" />
                <span><b>{itemName(t.item, lang)}</b><span>{labelOf(CAT_LABEL, t.item.type, lang)} · {labelOf(CHIP_LABEL, t.slot, lang)}</span></span>
                <button className="iconbtn x" onClick={() => setTray((prev) => { const n = new Map(prev); n.delete(key); return n; })}><X size={16} /></button>
              </div>
            ))}
          </div>
          <div className="trayfoot">
            <button className="modalbtn" onClick={() => setTray(new Map())}>{tr(lang, 'clear')}</button>
            <button className="modalbtn" onClick={() => { if (saveCombo()) { setTrayOpen(false); navTo('history'); } }}>{tr(lang, 'saveCombo')}</button>
            <button className="primary" style={{ flex: 1 }} onClick={() => { saveCombo(); setView('studio'); setTrayOpen(false); }}>{tr(lang, 'generate')}</button>
          </div>
        </div>
      )}

      {detail && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) setDetail(null); }}>
          <div className="modal">
            <button className="modalx" onClick={() => setDetail(null)} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <div className="modalgrid">
              <img src={detailImg} alt={itemName(detail, lang)} />
              <div className="modalinfo">
                <p className="kv" style={{ margin: '0 0 4px' }}>
                  {detail.id} · {labelOf(CHIP_LABEL, (CATS.find((c) => c.id === detail.type) || cat)?.chip(detail) || '', lang)}
                  {detailIdx >= 0 ? ` · ${detailIdx + 1}/${filtered.length}` : ''}
                </p>
                <p className="kv" style={{ margin: '0 0 8px' }}>
                  {tr(lang, 'sourceLabel')}：{sourceInfo(detail).author} · <a href={sourceInfo(detail).url} target="_blank" rel="noreferrer">{sourceInfo(detail).site}</a>
                </p>
                <div className="modaltitle">
                  <h2 style={{ margin: 0 }}>{itemName(detail, lang)}</h2>
                  <button className={`favstar ${favs.has(detail.id) ? 'on' : ''}`} onClick={() => toggleFav(detail.id)} aria-label={tr(lang, 'favorite')}>
                    <Star size={20} fill={favs.has(detail.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
                {(detail.names?.ja || detail.names?.en || detail.names?.ko) && (
                  <div className="kv" style={{ marginBottom: 10 }}>
                    {detail.names?.ja && <div>JA　{detail.names.ja}</div>}
                    {detail.names?.en && <div>EN　{detail.names.en}</div>}
                    {detail.names?.ko && <div>KO　{detail.names.ko}</div>}
                  </div>
                )}
                <div className="viewthumbs">
                  {viewsOf(detail).map((v) => {
                    const pLayer = primaryLayer(detail);
                    const hasPrimary = !!detail.variants[v]?.[pLayer];
                    return (
                      <button key={v} className={`vthumb ${dView === v ? 'active' : ''}`} onClick={() => { setDView(v); setDLayer(preferredLayer(detail, v)); }}>
                        <img src={viewThumbOf(detail, v, pLayer)} alt={v} />
                        {!hasPrimary && <span className="vtag">{labelOf(LAYER_LABEL, preferredLayer(detail, v), lang)}</span>}
                        <span>{labelOf(VIEW_LABEL, v, lang)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="chips" style={{ margin: '10px 0' }}>
                  {layersOf(detail, dView).map((l) => (
                    <button key={l} className={`chip ${dLayer === l ? 'active' : ''}`} onClick={() => setDLayer(l)}>{labelOf(LAYER_LABEL, l, lang)}</button>
                  ))}
                </div>
                <p className="kv" style={{ marginBottom: 6 }}>{tr(lang, 'sameViewFormats')}</p>
                {detail.description && (
                  <div className="descbox">
                    <span>{detail.description}</span>
                    <button className="modalbtn" onClick={() => copyText(detail.description || '')}><Copy size={16} />{tr(lang, 'copy')}</button>
                  </div>
                )}
                <div className="row modal-actions-desktop" style={{ marginTop: 12 }}>
                  <button className="primary" style={{ padding: '9px 14px' }} onClick={() => { addToTray(detail, CATS.find((c) => c.id === detail.type) || cat!); setDetail(null); }}>
                    <Plus size={16} />{tr(lang, 'addToTrayThis')}
                  </button>
                  <a className="modalbtn" href={detail ? origImageOf(detail, dView, dLayer) : detailImg} download={`${detail.id}-${dView}-${dLayer}.${(detail ? origImageOf(detail, dView, dLayer) : detailImg).split('.').pop() || 'png'}`}>{tr(lang, 'downloadImage')}</a>
                </div>
                <p className="kv" style={{ marginTop: 12 }}>{tr(lang, 'modalHint')}</p>
              </div>
            </div>
            <div className="modal-actions-mobile">
              <button className="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { addToTray(detail, CATS.find((c) => c.id === detail.type) || cat!); setDetail(null); }}>
                <Plus size={16} />{tr(lang, 'addToTrayThis')}
              </button>
              <a className="modalbtn" style={{ flex: 1, justifyContent: 'center' }} href={detail ? origImageOf(detail, dView, dLayer) : detailImg} download={`${detail.id}-${dView}-${dLayer}.${(detail ? origImageOf(detail, dView, dLayer) : detailImg).split('.').pop() || 'png'}`}>{tr(lang, 'downloadImage')}</a>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) setSettingsOpen(false); }}>
          <div className="modal" style={{ maxWidth: 520, height: 'auto', overflow: 'auto', maxHeight: '88vh' }}>
            <button className="modalx" onClick={() => setSettingsOpen(false)} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <h2 style={{ marginTop: 0 }}>{tr(lang, 'apiSettings')}</h2>
            <p className="note">{tr(lang, 'keyLocalOnly')}</p>
            <div className="field">
              <label>{tr(lang, 'vendor')}</label>
              <select value={settingsDraft.provider} onChange={(e) => {
                const p = e.target.value as Settings['provider'];
                setSettingsDraft(switchProvider(settingsDraft, p));
              }}>
                <option value="qwen">阿里百炼 · Qwen</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="doubao">火山引擎 · 豆包</option>
                <option value="comfyui">ComfyUI</option>
              </select>
            </div>
            <div className="field"><label>{tr(lang, 'model')}</label><input value={settingsDraft.model} onChange={(e) => setSettingsDraft({ ...settingsDraft, model: e.target.value })} /></div>
            <div className="field"><label>{tr(lang, 'baseUrl')}</label><input value={settingsDraft.baseUrl} onChange={(e) => setSettingsDraft({ ...settingsDraft, baseUrl: e.target.value })} placeholder={PROVIDER_BASE_URLS[settingsDraft.provider]} /><p className="kv" style={{ margin: '6px 0 0' }}>{settingsDraft.provider === 'comfyui' ? tr(lang, 'baseUrlHintLocal') : tr(lang, 'baseUrlHint')}</p></div>
            <div className="field"><label>{tr(lang, 'apiKey')}</label><div className="row" style={{ gap: 8 }}><input type={showKey ? 'text' : 'password'} value={settingsDraft.apiKey} onChange={(e) => setSettingsDraft({ ...settingsDraft, apiKey: e.target.value })} style={{ flex: 1 }} /><button className="modalbtn" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}{showKey ? tr(lang, 'hideKey') : tr(lang, 'showKey')}</button></div></div>
            <p className="note">{tr(lang, 'providerNote')}</p>
            <div className="row">
              <button className="primary" onClick={() => { setSettings(settingsDraft); saveSettings(settingsDraft); saveProviderConfig(settingsDraft.provider, settingsDraft); setSettingsOpen(false); }}>{tr(lang, 'saveLocal')}</button>
              <button className="modalbtn" onClick={() => setSettingsOpen(false)}>{tr(lang, 'close')}</button>
              <button className="modalbtn danger" onClick={() => { const n = { ...settingsDraft, apiKey: '' }; setSettingsDraft(n); setSettings(n); saveSettings(n); saveProviderConfig(n.provider, n); }}>{tr(lang, 'clearKey')}</button>
            </div>
          </div>
        </div>
      )}
      {uploadOpen && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) { if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadOpen(false); setUploadFile(null); setUploadPreview(''); } }}>
          <div className="modal" style={{ maxWidth: 520, height: 'auto', overflow: 'auto', maxHeight: '88vh' }}>
            <button className="modalx" onClick={() => { if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadOpen(false); setUploadFile(null); setUploadPreview(''); }} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <h2 style={{ marginTop: 0 }}>{tr(lang, 'uploadImage')}</h2>
            <div className="field">
              <input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (uploadPreview) URL.revokeObjectURL(uploadPreview);
                setUploadFile(f);
                setUploadPreview(f ? URL.createObjectURL(f) : '');
              }} />
            </div>
            {uploadPreview && <img src={uploadPreview} alt="" style={{ width: '100%', maxWidth: 320, borderRadius: 12, marginBottom: 12, display: 'block' }} />}
            <div className="field">
              <label>{tr(lang, 'uploadCategory')}</label>
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value as TopId)}>
                {CATS.map((c) => (<option key={c.id} value={c.id}>{labelOf(CAT_LABEL, c.id, lang)}</option>))}
              </select>
            </div>
            <div className="field">
              <label>{tr(lang, 'uploadDesc')}</label>
              <textarea value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder={tr(lang, 'uploadDescHint')} style={{ minHeight: 90 }} />
            </div>
            <div className="row">
              <button className="primary" disabled={!uploadFile} onClick={confirmUpload}>{tr(lang, 'uploadImage')}</button>
              <button className="modalbtn" onClick={() => { if (uploadPreview) URL.revokeObjectURL(uploadPreview); setUploadOpen(false); setUploadFile(null); setUploadPreview(''); }}>{tr(lang, 'close')}</button>
            </div>
            <p className="note" style={{ marginTop: 12 }}>{tr(lang, 'uploadDescHint')}</p>
          </div>
        </div>
      )}
      {appSettingsOpen && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) setAppSettingsOpen(false); }}>
          <div className="modal" style={{ maxWidth: 520, height: 'auto', overflow: 'auto', maxHeight: '88vh' }}>
            <button className="modalx" onClick={() => setAppSettingsOpen(false)} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <h2 style={{ marginTop: 0 }}>{tr(lang, 'settings')}</h2>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{tr(lang, 'suggestive')}</span>
              <button className="switch" aria-label={tr(lang, 'suggestive')} aria-pressed={showSuggestive} onClick={() => setShowSuggestive(!showSuggestive)}>
                <span className="switch-track" />
              </button>
            </div>
            <div className="row">
              <button className="modalbtn danger" onClick={clearAllCache}><Trash2 size={16} />{tr(lang, 'clearCache')}</button>
              <button className="modalbtn" onClick={() => setAppSettingsOpen(false)}>{tr(lang, 'close')}</button>
            </div>
          </div>
        </div>
      )}
      {sourcesOpen && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) setSourcesOpen(false); }}>
          <div className="modal" style={{ maxWidth: 520, height: 'auto', overflow: 'auto', maxHeight: '88vh' }}>
            <button className="modalx" onClick={() => setSourcesOpen(false)} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <h2 style={{ marginTop: 0 }}>{tr(lang, 'attributionTitle')}</h2>
            <div className="srclist">
              <div>姿势 / 写实服装 / 场景 / 家具 / 道具 / 光线 / 动物 — Shisei 项目（CC0）· <a href="https://shisei.indaloop.app/en/" target="_blank" rel="noreferrer">shisei.indaloop.app</a></div>
              <div>动漫服装 — ギア · <a href="https://ai-costume-anime-gallery.pages.dev/" target="_blank" rel="noreferrer">ai-costume-anime-gallery</a></div>
              <div>人脸（1499 张）— あぎ · <a href="https://ai-portrait-gallery.pages.dev/" target="_blank" rel="noreferrer">AI Portrait Gallery</a></div>
              <div>人脸（自建 27 张）— omilic · <a href="https://omilic.com/" target="_blank" rel="noreferrer">omilic.com</a></div>
            </div>
            <p className="kv" style={{ marginTop: 14 }}>{tr(lang, 'thanksText')}</p>
            <p className="note" style={{ marginTop: 10 }}>{tr(lang, 'footerNote')}</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="modalbtn" onClick={() => setSourcesOpen(false)}>{tr(lang, 'close')}</button>
            </div>
          </div>
        </div>
      )}
      {getCardOpen && (
        <div className="backdrop open" onClick={(e) => { if ((e.target as HTMLElement).className.includes('backdrop')) setGetCardOpen(false); }}>
          <div className="modal" style={{ maxWidth: 420, height: 'auto', overflow: 'auto', maxHeight: '88vh', textAlign: 'center' }}>
            <button className="modalx" onClick={() => setGetCardOpen(false)} aria-label={tr(lang, 'close')}><X size={18} /></button>
            <h2 style={{ marginTop: 0 }}>{tr(lang, 'getCardTitle')}</h2>
            <p style={{ fontSize: 14 }}>{tr(lang, 'getCardHint')}</p>
            <img src="/xhs-qr.png" alt="" style={{ width: 220, height: 220, objectFit: 'contain', margin: '8px auto', display: 'block' }} />
            <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
              <button className="modalbtn" onClick={() => setGetCardOpen(false)}>{tr(lang, 'close')}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
