const $ = s => document.querySelector(s);
const labels = {front:'正面',diag:'斜侧',side:'侧面',above:'俯视',below:'仰视',back:'背面',line:'线稿',clay:'白模',depth:'深度图',normal:'法线图',photo:'实拍',image:'原图'};
const types = {pose:'姿势',costume:'服装'};
const seriesNames = {std:'全身 · 标准',upper:'上半身',sexy:'全身 · 性感',duo:'双人'};
const viewOrder = ['front','diag','side','back','above','below'];
const layerOrder = ['line','clay','depth','normal','photo','image'];
let data=[], type='pose', category='全部', onlyFavorites=false, current=null, view='', layer='' ;
let favorites=new Set(), selection={};
try { favorites=new Set(JSON.parse(localStorage.getItem('pose-favorites') || '[]')); selection=JSON.parse(localStorage.getItem('pose-selection') || '{}'); } catch { favorites=new Set(); selection={}; }
function save() { try { localStorage.setItem('pose-favorites',JSON.stringify([...favorites])); localStorage.setItem('pose-selection',JSON.stringify(selection)); } catch {} }
function button(text,action,className='') {const b=document.createElement('button'); b.type='button'; b.textContent=text; b.className=className; b.addEventListener('click',action); return b;}
function icon(name) {const i=document.createElement('i'); i.className=`ti ti-${name}`; i.setAttribute('aria-hidden','true'); return i;}
function imageFor(item,v,l,size='w900') {const sizes=item?.variants?.[v]?.[l]; return sizes?.[size] || sizes?.w900 || '';}
function viewsOf(item) {return viewOrder.filter(v => item.variants[v]);}
function layersOf(item,v) {return layerOrder.filter(l => imageFor(item,v,l));}
function firstVariant(item) {for (const v of viewOrder) for (const l of layerOrder) if (imageFor(item,v,l)) return {view:v,layer:l}; return {view:'front',layer:'line'};}
function same(a,b) {return a && b && a.type===b.type && a.id===b.id;}
function setType(next) {type=next; category='全部'; $('#search').value=''; render();}
function closeDetail() {if ($('#detail').open) $('#detail').close(); current=null; render();}
function copyText(text, el) {navigator.clipboard.writeText(text).then(()=>{const old=el.textContent; el.textContent='已复制'; setTimeout(()=>el.textContent=old,1200);}).catch(()=>{el.textContent='复制失败';});}
function renderNav() {
  $('#type-nav').replaceChildren(...Object.entries(types).map(([key,name])=>{
    const b=button('',()=>setType(key),`nav-item ${type===key?'active':''}`);
    const symbol=icon(key==='pose'?'user':'shirt'); symbol.classList.add('nav-icon');
    const text=document.createElement('span'); text.textContent=`${name}参考`;
    const count=document.createElement('b'); count.textContent=data.filter(x=>x.type===key).length;
    b.append(symbol,text,count); b.setAttribute('aria-current',type===key?'page':'false'); return b;
  }));
}
function render() {
  renderNav(); $('#page-title').textContent=`${types[type]}参考`; $('#page-desc').textContent=type==='pose'?'选一个姿势，开启你的创作。':'挑一身服装，为画面增添风格。'; $('#result-label').textContent=type==='pose'?'组姿势':'套服装';
  const available=data.filter(p=>p.type===type && ($('#show-suggestive').checked || p.rating!=='suggestive'));
  const categories=['全部',...new Set(available.map(p=>p.category).filter(Boolean))]; if(!categories.includes(category)) category='全部';
  $('#categories').replaceChildren(...categories.map(c=>button(c,()=>{category=c;render();},`chip ${c===category?'selected':''}`)));
  const query=$('#search').value.trim().toLowerCase();
  const filtered=available.filter(p=>(category==='全部'||p.category===category)&&(!onlyFavorites||favorites.has(`${p.type}:${p.id}`)||(p.type==='pose'&&favorites.has(p.id)))&&[p.id,p.name,p.category].some(x=>(x||'').toLowerCase().includes(query)));
  $('#favorite-count').textContent=favorites.size; $('#result-count').textContent=filtered.length; $('#status').textContent=filtered.length?'':'没有找到符合条件的素材。';
  $('#grid').replaceChildren(...filtered.map(p=>{
    const card=document.createElement('article'); card.className='pose-card';
    const open=button('',()=>openDetail(p),'pose-open'); open.setAttribute('aria-label',`查看${p.name}`);
    const v=firstVariant(p); const img=document.createElement('img'); img.loading='lazy'; img.width=300; img.height=400; img.alt=''; img.src=imageFor(p,v.view,v.layer,'w300');
    const info=document.createElement('div'); info.className='card-info'; const title=document.createElement('strong'); title.textContent=p.name; const sub=document.createElement('span'); sub.textContent=`${p.category} · ${p.id}`; info.append(title,sub); open.append(img,info);
    const key=`${p.type}:${p.id}`; const liked=favorites.has(key)||(p.type==='pose'&&favorites.has(p.id));
    const fav=button('',e=>{e.stopPropagation(); if(liked){favorites.delete(key); favorites.delete(p.id);} else favorites.add(key); save(); render();},'favorite'); fav.append(icon('heart')); fav.setAttribute('aria-label',`${liked?'取消收藏':'收藏'} ${p.name}`); fav.setAttribute('aria-pressed',liked); card.append(open,fav); return card;
  }));
}
function stepView(direction) {
  if (!current) return;
  const views=viewsOf(current); const index=views.indexOf(view);
  view=views[(index+direction+views.length)%views.length]; layer=layersOf(current,view)[0];
  if ($('#detail').open) renderDetail();
}
function openDetail(item) {
  current=item; if (!viewsOf(item).includes(view)) ({view,layer}=firstVariant(item)); if (!layersOf(item,view).includes(layer)) layer=layersOf(item,view)[0];
  renderDetail(); if (!$('#detail').open) $('#detail').showModal();
}
function renderDetail() {
  const dialog=$('#detail'); if (!current) return; dialog.replaceChildren();
  const layout=document.createElement('div'); layout.className='detail-layout';
  const stage=document.createElement('div'); stage.className='detail-stage'; const image=document.createElement('img'); image.src=imageFor(current,view,layer); image.alt=`${current.name}，${labels[view]}，${labels[layer]}`; stage.append(image);
  const copy=document.createElement('div'); copy.className='detail-copy';
  const head=document.createElement('header'); head.className='dialog-head'; const titleWrap=document.createElement('div'); const kicker=document.createElement('p'); kicker.className='meta-line'; kicker.textContent=`${current.id} · ${current.category} · ${types[current.type]}`; const heading=document.createElement('h2'); heading.textContent=current.name; titleWrap.append(kicker,heading); const close=button('',closeDetail,'icon-button'); close.append(icon('x')); close.setAttribute('aria-label','关闭详情'); head.append(titleWrap,close);
  const scroll=document.createElement('div'); scroll.className='detail-scroll';
  const langs=document.createElement('div'); langs.className='lang-list'; for (const [code,value] of [['JA',current.names?.ja],['EN',current.names?.en],['KO',current.names?.ko]]) if (value) {const row=document.createElement('div'); const b=document.createElement('b'); b.textContent=code; row.append(b,document.createTextNode(value)); langs.append(row);}
  const viewLabel=document.createElement('div'); viewLabel.className='control-label'; viewLabel.textContent='视角'; const views=document.createElement('div'); views.className='option-list'; viewsOf(current).forEach(v=>views.append(button(labels[v],()=>{view=v; if(!layersOf(current,view).includes(layer)) layer=layersOf(current,view)[0]; renderDetail();},`option ${v===view?'selected':''}`)));
  const layerLabel=document.createElement('div'); layerLabel.className='control-label'; layerLabel.textContent='格式'; const layers=document.createElement('div'); layers.className='layer-grid'; layersOf(current,view).forEach(l=>{const tile=button('',()=>{layer=l; renderDetail();},`layer-tile ${l===layer?'selected':''}`); const thumb=document.createElement('img'); thumb.src=imageFor(current,view,l,'w300'); thumb.alt=''; tile.append(thumb,document.createTextNode(labels[l])); layers.append(tile);});
  const prompt=document.createElement('div'); prompt.className='prompt-card'; const promptHead=document.createElement('header'); promptHead.append(document.createTextNode('英文描述')); const copyPrompt=button('复制',()=>copyText(current.description || current.id, copyPrompt),'text-button'); promptHead.append(copyPrompt); const text=document.createElement('p'); text.textContent=current.description || '当前素材暂无英文描述。'; prompt.append(promptHead,text);
  const add=button(selection[current.type]?.id===current.id?'更新搭配':'加入搭配',()=>{selection[current.type]={id:current.id,view,layer}; save(); renderTray(); renderDetail();},'secondary-action'); add.prepend(icon('plus'));
  const download=document.createElement('a'); download.className='primary-action'; download.href=imageFor(current,view,layer); download.download=`${current.id}-${view}-${layer}.webp`; download.append(icon('download'), document.createTextNode(` 下载这张 · ${labels[layer]}`));
  const note=document.createElement('p'); note.className='hint'; note.textContent='来源：Shisei · 仅限非商业使用';
  scroll.append(langs,viewLabel,views,layerLabel,layers,prompt); const actions=document.createElement('div'); actions.className='detail-actions'; actions.append(add,download,note); copy.append(head,scroll,actions); layout.append(stage,copy); dialog.append(layout);
}
function renderTray() {
  const entries=Object.keys(types).map(key=>{const s=selection[key]; const item=data.find(p=>p.type===key&&p.id===s?.id); return item&&imageFor(item,s.view,s.layer)?{key,item,...s}:null;}).filter(Boolean);
  $('#tray-count').textContent=entries.length; const slots=$('#tray-slots'); slots.replaceChildren();
  for (const [key,name] of Object.entries(types)) {
    const entry=entries.find(e=>e.key===key); const slot=button('',()=>{if(entry){if(type!==key){type=key;category='全部';render();} view=entry.view; layer=entry.layer; openDetail(entry.item);} else setType(key);},`tray-slot ${entry?'filled':''}`); slot.setAttribute('aria-label',entry?`查看已选${name} ${entry.item.name}`:`选择${name}`);
    if (entry) {const img=document.createElement('img'); img.src=imageFor(entry.item,entry.view,entry.layer,'w300'); img.alt=''; const text=document.createElement('span'); text.textContent=`${name} · ${entry.item.id}`; slot.append(img,text);} else slot.append(icon('plus'),` ${name}`); slots.append(slot);
  }
  const items=$('#tray-items'); items.replaceChildren(); if (!entries.length) {const p=document.createElement('p'); p.className='tray-empty'; p.textContent='还没有选择素材'; items.append(p);}
  for (const e of entries) {const item=document.createElement('div'); item.className='tray-item'; const img=document.createElement('img'); img.src=imageFor(e.item,e.view,e.layer,'w300'); img.alt=''; const info=document.createElement('div'); info.className='tray-item-info'; const sub=document.createElement('small'); sub.textContent=`${types[e.key]} · ${labels[e.view]} · ${labels[e.layer]}`; const name=document.createElement('strong'); name.textContent=e.item.name; const id=document.createElement('span'); id.textContent=e.item.id; info.append(sub,name,id); const remove=button('',()=>{delete selection[e.key]; save(); renderTray(); if($('#detail').open) renderDetail();},'remove-item'); remove.append(icon('x')); remove.setAttribute('aria-label',`移除${types[e.key]} ${e.item.name}`); item.append(img,info,remove); items.append(item);}
  $('#prompt-text').textContent=entries.map(e=>e.item.description).filter(Boolean).join(', ') || '当前选择暂无描述。';
}
$('#search').addEventListener('input',render); $('#show-suggestive').addEventListener('change',render);
$('#favorites').addEventListener('click',()=>{onlyFavorites=!onlyFavorites; $('#favorites').setAttribute('aria-pressed',onlyFavorites); render();});
$('#tray-toggle').addEventListener('click',()=>{const panel=$('#tray-panel'); panel.hidden=!panel.hidden; $('#tray-toggle').textContent=panel.hidden?'展开':'收起'; $('#tray-toggle').setAttribute('aria-expanded',!panel.hidden);});
$('#clear-tray').addEventListener('click',()=>{selection={}; save(); renderTray(); if($('#detail').open) renderDetail();});
$('#copy-prompt').addEventListener('click',()=>copyText($('#prompt-text').textContent, $('#copy-prompt')));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); $('#search').focus();} if(e.key==='Escape'){closeDetail();} if((e.key==='ArrowLeft'||e.key==='ArrowRight') && $('#detail').open){e.preventDefault(); stepView(e.key==='ArrowLeft'?-1:1);}});
fetch('./catalog.json').then(r=>{if(!r.ok) throw Error(); return r.json();}).then(items=>{data=items.map(x=>({...x,type:x.type||'pose'})); render(); renderTray();}).catch(()=>{$('#status').textContent='素材目录未加载。请先按 README 导入数据，并通过本地服务器打开。'; renderTray();});
