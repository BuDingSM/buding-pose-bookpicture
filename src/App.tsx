import { useEffect, useMemo, useState } from 'react';
import type { CatalogItem, CustomRef, HistoryEntry, Settings, SlotValue } from './types';
import {
  DEFAULT_MODELS, DEFAULT_SETTINGS, GALLERY_TYPES, LAYER_LABELS, VIEW_LABELS,
  firstVariant, imageFor, layersOf, loadJson, viewsOf,
} from './types';
import { STYLE_PRESETS, assemblePrompt, blobToDataUrl, collageItems, downloadDataUrl, exportCollage, srcToDataUrl } from './lib';
import { generateImage } from './generate';
import './styles.css';

const SLOT_ORDER = ['portrait', 'pose', 'costume', 'scene', 'furniture', 'prop', 'light', 'animal'];
const SLOT_LABELS: Record<string, string> = {
  portrait: '人像（头像）', pose: '姿势', costume: '服装', scene: '场景',
  furniture: '家具', prop: '道具', light: '光线', animal: '动物',
};
const IMPORT_INSTRUCTIONS = `素材目录未加载。请先生成它：\n\n1. 准备一份本地 Shisei 仓库（包含 data/catalog.json 和 images/）。\n2. cd public && node ../scripts/import-shisei.mjs /path/to/shisei\n3. 重新运行 npm run dev（或 npm run build 后用静态服务器打开 dist）。\n\n生成的 catalog.json 与 assets/ 不提交到 Git；图片来自 Shisei（CC0）。`;

type View = 'gallery' | 'studio' | 'settings' | 'history';

export default function App() {
  const [view, setView] = useState<View>('gallery');
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [galleryType, setGalleryType] = useState<string>('pose');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [showSuggestive, setShowSuggestive] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pbs-favorites') || '[]'); } catch { return []; }
  });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [detail, setDetail] = useState<{ item: CatalogItem; view: string; layer: string } | null>(null);
  const [slots, setSlots] = useState<Record<string, SlotValue>>({});
  const [styleId, setStyleId] = useState('none');
  const [customRefs, setCustomRefs] = useState<CustomRef[]>([]);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [portraitUrl, setPortraitUrl] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [settings, setSettings] = useState<Settings>(() => loadJson('pbs-settings', DEFAULT_SETTINGS));
  const [showKey, setShowKey] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('pbs-history') || '[]'); } catch { return []; }
  });
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [genResult, setGenResult] = useState('');
  const [collageMsg, setCollageMsg] = useState('');

  useEffect(() => {
    fetch('./catalog.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((items: CatalogItem[]) => setCatalog(items))
      .catch(() => setCatalogError(IMPORT_INSTRUCTIONS));
  }, []);
  useEffect(() => { localStorage.setItem('pbs-favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem('pbs-settings', JSON.stringify({ ...settings, apiKey: settings.apiKey })); }, [settings]);
  useEffect(() => { localStorage.setItem('pbs-history', JSON.stringify(history)); }, [history]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog.filter((item) =>
      item.type === galleryType &&
      (showSuggestive || item.rating !== 'suggestive') &&
      (category === '全部' || item.category === category) &&
      (!onlyFavorites || favorites.includes(`${item.type}:${item.id}`)) &&
      (!q || [item.id, item.name, item.category].some((x) => (x || '').toLowerCase().includes(q))),
    );
  }, [catalog, galleryType, query, category, showSuggestive, onlyFavorites, favorites]);

  const categories = useMemo(() => {
    if (!catalog) return ['全部'];
    return ['全部', ...new Set(catalog.filter((i) => i.type === galleryType).map((i) => i.category || '未分类'))];
  }, [catalog, galleryType]);

  const prompt = useMemo(() => assemblePrompt(slots, styleId, customRefs), [slots, styleId, customRefs]);

  function toggleFavorite(item: CatalogItem) {
    const key = `${item.type}:${item.id}`;
    setFavorites((f) => f.includes(key) ? f.filter((x) => x !== key) : [...f, key]);
  }
  function assignToSlot(item: CatalogItem) {
    const { view: v, layer: l } = firstVariant(item);
    setSlots((s) => ({ ...s, [item.type]: { kind: 'catalog', item, view: v, layer: l } }));
    setPendingSlot(null);
    setView('studio');
  }
  function pickFromGallery(slotKey: string) {
    setPendingSlot(slotKey);
    if (slotKey !== 'portrait') setGalleryType(slotKey);
    setView('gallery');
  }
  async function handlePortraitFile(file: File) {
    const src = await blobToDataUrl(file);
    setSlots((s) => ({ ...s, portrait: { kind: 'upload', src, name: file.name } }));
  }
  async function handleCustomFiles(files: FileList | null) {
    if (!files) return;
    const next: CustomRef[] = [];
    for (const f of Array.from(files)) {
      next.push({ id: `${Date.now()}-${f.name}`, src: await blobToDataUrl(f), name: f.name });
    }
    setCustomRefs((r) => [...r, ...next]);
  }
  async function doCollage() {
    setCollageMsg('');
    try {
      const dataUrl = await exportCollage(collageItems(slots, customRefs));
      downloadDataUrl(dataUrl, 'pose-book-collage.png');
      setCollageMsg('参考拼图已下载（PNG）。');
    } catch (e) {
      setCollageMsg(e instanceof Error ? e.message + ' 建议改用上传文件而不是粘贴外链图片。' : '拼图导出失败。');
    }
  }
  async function doGenerate() {
    setGenError(''); setGenResult(''); setGenerating(true);
    const entryBase = { id: String(Date.now()), at: new Date().toISOString(), provider: settings.provider, model: settings.model, prompt };
    try {
      const refs: string[] = [];
      for (const item of collageItems(slots, customRefs)) refs.push(await srcToDataUrl(item.src));
      const image = await generateImage(settings, prompt, refs);
      setGenResult(image);
      setHistory((h) => [{ ...entryBase, image }, ...h]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '生成失败。';
      setGenError(msg);
      setHistory((h) => [{ ...entryBase, error: msg }, ...h]);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Pose Book Studio</strong>
        <span className="tagline">多品类参考 · 拼成一张图 · V1 只用你自己的 Key</span>
        <nav>
          {(['gallery', 'studio', 'settings', 'history'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {v === 'gallery' ? '图库' : v === 'studio' ? '合成台' : v === 'settings' ? '设置' : '生成记录'}
            </button>
          ))}
        </nav>
      </header>

      {view === 'gallery' && (
        <main>
          {pendingSlot && <p className="notice">正在为「{SLOT_LABELS[pendingSlot]}」挑选：点任意素材卡片即可填入该槽位。</p>}
          <div className="type-nav">
            {GALLERY_TYPES.map((t) => (
              <button key={t.key} className={galleryType === t.key ? 'active' : ''} onClick={() => { setGalleryType(t.key); setCategory('全部'); }}>
                {t.label}（{catalog?.filter((i) => i.type === t.key).length ?? '—'}）
              </button>
            ))}
          </div>
          <div className="toolbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、分类或编号" aria-label="搜索" />
            <button onClick={() => setOnlyFavorites(!onlyFavorites)} aria-pressed={onlyFavorites}>收藏 {favorites.length}</button>
            <label><input type="checkbox" checked={showSuggestive} onChange={(e) => setShowSuggestive(e.target.checked)} /> 显示成人向参考</label>
          </div>
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          {catalogError ? <pre className="error-box">{catalogError}</pre> : (
            <>
              <p>{filtered.length} 条结果</p>
              <div className="grid">
                {filtered.map((item) => {
                  const v = firstVariant(item);
                  const src = imageFor(item, v.view, v.layer, 'w300');
                  const fav = favorites.includes(`${item.type}:${item.id}`);
                  return (
                    <article key={`${item.type}:${item.id}`} className="card">
                      <button className="card-open" onClick={() => {
                        if (pendingSlot && pendingSlot !== 'portrait' && pendingSlot === item.type) { assignToSlot(item); return; }
                        setDetail({ item, view: v.view, layer: v.layer });
                      }}>
                        {src ? <img src={src} alt={item.name} loading="lazy" /> : <div className="no-img">无图</div>}
                        <strong>{item.name}</strong>
                        <span>{item.category} · {item.id}</span>
                      </button>
                      <button className="fav" aria-label={fav ? '取消收藏' : '收藏'} onClick={() => toggleFavorite(item)}>{fav ? '♥' : '♡'}</button>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {detail && (
            <div className="dialog-backdrop" onClick={() => setDetail(null)}>
              <div className="dialog" onClick={(e) => e.stopPropagation()}>
                <button className="close" onClick={() => setDetail(null)}>×</button>
                <img src={imageFor(detail.item, detail.view, detail.layer)} alt={detail.item.name} />
                <h2>{detail.item.name}</h2>
                <p>{detail.item.id} · {detail.item.category} · {detail.item.series || ''}</p>
                <p>{detail.item.description || '暂无英文描述。'}</p>
                <div><strong>视角：</strong>{viewsOf(detail.item).map((v) => (
                  <button key={v} className={detail.view === v ? 'selected' : ''} onClick={() => setDetail((d) => d && { ...d, view: v, layer: layersOf(d.item, v)[0] || d.layer })}>{VIEW_LABELS[v] || v}</button>
                ))}</div>
                <div><strong>图层：</strong>{layersOf(detail.item, detail.view).map((l) => (
                  <button key={l} className={detail.layer === l ? 'selected' : ''} onClick={() => setDetail((d) => d && { ...d, layer: l })}>{LAYER_LABELS[l] || l}</button>
                ))}</div>
                <div className="actions">
                  <a className="primary" href={imageFor(detail.item, detail.view, detail.layer)} download={`${detail.item.id}-${detail.view}-${detail.layer}.webp`}>下载这张</a>
                  <button onClick={() => { assignToSlot(detail.item); setDetail(null); }}>加入合成台</button>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {view === 'studio' && (
        <main>
          <h1>合成台</h1>
          <p>每类最多一项；点“从图库挑选”填入槽位。人像槽位目前没有内置图库，请上传或粘贴你自己的参考图。</p>
          <div className="slots">
            {SLOT_ORDER.map((key) => {
              const value = slots[key];
              return (
                <section key={key} className="slot">
                  <h3>{SLOT_LABELS[key]}</h3>
                  {key === 'portrait' && (
                    <div className="portrait-note">
                      <p>⚠️ V1 不内置人像图：来源尚未确定，不使用未授权的图库图片。请上传你自己的参考图。</p>
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePortraitFile(f); }} />
                      <div className="row">
                        <input value={portraitUrl} onChange={(e) => setPortraitUrl(e.target.value)} placeholder="或粘贴图片 URL" />
                        <button onClick={() => { if (portraitUrl.trim()) { setSlots((s) => ({ ...s, portrait: { kind: 'upload', src: portraitUrl.trim(), name: 'pasted portrait' } })); setPortraitUrl(''); } }}>添加</button>
                      </div>
                    </div>
                  )}
                  {value?.kind === 'catalog' && (
                    <div>
                      <img src={imageFor(value.item, value.view, value.layer, 'w300')} alt={value.item.name} />
                      <p>{value.item.name}（{value.item.id}）</p>
                    </div>
                  )}
                  {value?.kind === 'upload' && key !== 'portrait' && <img src={value.src} alt={value.name} />}
                  {value?.kind === 'upload' && key === 'portrait' && <img src={value.src} alt="uploaded portrait" />}
                  {!value && key !== 'portrait' && <button onClick={() => pickFromGallery(key)}>从图库挑选</button>}
                  {value && <button onClick={() => setSlots((s) => ({ ...s, [key]: null }))}>清空</button>}
                </section>
              );
            })}
            <section className="slot">
              <h3>画风（文字预设）</h3>
              <p>手绘 367 种画风尚未导入，V1 先用内置通用预设。</p>
              <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                {STYLE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </section>
          </div>

          <section>
            <h2>自定义参考图（不限张数）</h2>
            <input type="file" accept="image/*" multiple onChange={(e) => void handleCustomFiles(e.target.files)} />
            <div className="row">
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="或粘贴图片 URL" />
              <button onClick={() => { if (customUrl.trim()) { setCustomRefs((r) => [...r, { id: String(Date.now()), src: customUrl.trim(), name: 'pasted reference' }]); setCustomUrl(''); } }}>添加</button>
            </div>
            <div className="thumbs">
              {customRefs.map((r) => (
                <span key={r.id}><img src={r.src} alt={r.name} /><button onClick={() => setCustomRefs((x) => x.filter((y) => y.id !== r.id))}>×</button></span>
              ))}
            </div>
          </section>

          <section>
            <h2>结构化提示词（固定顺序：画风 → 场景 → 光线 → 姿势 → 服装 → 家具 → 道具 → 动物 → 人像说明）</h2>
            <textarea value={prompt} readOnly rows={6} />
            <button onClick={() => void navigator.clipboard.writeText(prompt)}>复制提示词</button>
          </section>

          <section>
            <h2>参考拼图与生成</h2>
            <button onClick={() => void doCollage()}>导出参考拼图 PNG</button>
            {collageMsg && <p>{collageMsg}</p>}
            <p>当前供应商：{settings.provider} / 模型：{settings.model || '（未填）'}。没有 Key 时请先去“设置”填你自己的 Key。</p>
            <button className="primary" disabled={generating} onClick={() => void doGenerate()}>{generating ? '生成中…' : '用我的 Key 生成'}</button>
            {genError && <p className="error-text">{genError}</p>}
            {genResult && <div><img className="result" src={genResult} alt="generated result" /><p><a href={genResult} download="pose-book-result.png">下载生成图</a></p></div>}
          </section>
        </main>
      )}

      {view === 'settings' && (
        <main>
          <h1>设置 · 只用你自己的 Key</h1>
          <p className="notice">Key 只存在这个浏览器的 localStorage 里，不会发给我们的服务器、不会进代码仓库。生成时它只发给你在下面选的供应商。以后官方 Key 是另一套后端方案，V1 不做。</p>
          <label>供应商
            <select value={settings.provider} onChange={(e) => {
              const provider = e.target.value as Settings['provider'];
              setSettings((s) => ({ ...s, provider, model: DEFAULT_MODELS[provider] }));
            }}>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI GPT Image</option>
              <option value="qwen">阿里云百炼 Qwen</option>
              <option value="doubao">字节火山方舟 Doubao</option>
              <option value="comfyui">本地 ComfyUI</option>
            </select>
          </label>
          <label>模型（可改）
            <input value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} placeholder="例如 gemini-2.5-flash-image" />
          </label>
          {settings.provider !== 'comfyui' && (
            <label>API Key
              <div className="row">
                <input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))} autoComplete="off" />
                <button onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
                <button onClick={() => setSettings((s) => ({ ...s, apiKey: '' }))}>清除 Key</button>
              </div>
            </label>
          )}
          <label>Base URL / 端点
            <input value={settings.baseUrl} onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))} />
          </label>
          <p className="hint">
            Gemini / OpenAI 用默认端点即可，Base URL 留空效果相同。Qwen 默认走 DashScope；Doubao 默认走火山方舟北京区（可改成你所在区域的 Ark 域名）。
            Doubao 的参考图通常需要可公开访问的图片 URL，上传的本地图可能被个别模型拒绝，届时以供应商返回的错误为准。
          </p>
          {settings.provider === 'comfyui' && (
            <label>ComfyUI 工作流 JSON（.api.json，含 __PROMPT__ 占位符）
              <textarea value={settings.workflowJson} onChange={(e) => setSettings((s) => ({ ...s, workflowJson: e.target.value }))} rows={8} placeholder='{"1": {"class_type": "LoadImage", "inputs": {"image": ""}}, ...}' />
            </label>
          )}
          <p>设置会自动保存到本机浏览器。</p>
        </main>
      )}

      {view === 'history' && (
        <main>
          <h1>生成记录（仅本机）</h1>
          <button onClick={() => setHistory([])}>清空记录</button>
          {history.length === 0 && <p>还没有生成记录。</p>}
          {history.map((h) => (
            <article key={h.id} className="history-item">
              <p>{h.at} · {h.provider} / {h.model}</p>
              <p>{h.prompt}</p>
              {h.image && <img className="result" src={h.image} alt="history result" />}
              {h.error && <p className="error-text">{h.error}</p>}
            </article>
          ))}
        </main>
      )}
      <footer>图片数据：Shisei（CC0）经本地导入脚本生成；人像与手绘风格数据 V1 未内置。Key 只存本机浏览器。</footer>
    </div>
  );
}
