import type { Settings } from './types';

function errText(res: Response, body: string): string {
  let msg = `Provider returned HTTP ${res.status}`;
  try {
    const j = JSON.parse(body);
    const m = j.error?.message || j.message || j.error?.code || j.code;
    if (m) msg += `: ${m}`;
  } catch { /* keep the status text */ }
  return msg;
}

async function dataUrlToMimeAndB64(dataUrl: string): Promise<{ mime: string; b64: string }> {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Reference image is not a data URL; upload the file instead of pasting a remote URL for this provider.');
  return { mime: m[1], b64: m[2] };
}

/**
 * Gemini image generation (public API shape, verified against the
 * Gemini API docs pattern): POST
 * https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * with x-goog-api-key. Reference images go in as inlineData parts.
 * Returns a data URL, or throws with the provider's message.
 */
async function generateGemini(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
  const parts: unknown[] = [{ text: prompt }];
  for (const ref of refs) {
    const { mime, b64 } = await dataUrlToMimeAndB64(ref);
    parts.push({ inlineData: { mimeType: mime, data: b64 } });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(errText(res, body));
  const j = JSON.parse(body);
  for (const cand of j.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
  }
  throw new Error('Gemini returned no image. The model may not support image output; check the model name in Settings.');
}

/**
 * OpenAI image generation. Without references: POST /v1/images/generations.
 * With references: POST /v1/images/edits (multipart, image files + prompt).
 * Returns a data URL or a result URL.
 */
async function generateOpenAI(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  if (!refs.length) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, prompt }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(errText(res, body));
    const j = JSON.parse(body);
    const d = j.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
    throw new Error('OpenAI returned no image.');
  }
  const form = new FormData();
  for (const [i, ref] of refs.entries()) {
    const { mime, b64 } = await dataUrlToMimeAndB64(ref);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    form.append('image[]', new Blob([bytes], { type: mime }), `ref-${i}.png`);
  }
  form.append('model', settings.model);
  form.append('prompt', prompt);
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(errText(res, body));
  const j = JSON.parse(body);
  const d = j.data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (d?.url) return d.url;
  throw new Error('OpenAI returned no image.');
}

/**
 * Alibaba Qwen via DashScope (endpoint shape confirmed from public docs):
 * POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 * with messages [{ role: 'user', content: [{image}, {text}] }].
 * Result image URL is under output.choices[0].message.content[].image.
 * Note: reference images are sent as data URLs; DashScope accepts them,
 * but a provider-side rejection will surface as an error, not a fake image.
 */
async function generateQwen(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  const base = (settings.baseUrl || '').trim();
  const endpoint = base && base !== 'http://127.0.0.1:8188'
    ? `${base.replace(/\/$/, '')}/api/v1/services/aigc/multimodal-generation/generation`
    : 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const content: unknown[] = [];
  for (const ref of refs) content.push({ image: ref });
  content.push({ text: prompt });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, input: { messages: [{ role: 'user', content }] } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(errText(res, body));
  const j = JSON.parse(body);
  for (const choice of j.output?.choices ?? []) {
    for (const part of choice.message?.content ?? []) {
      if (part.image) return part.image;
    }
  }
  throw new Error('Qwen returned no image. Check the model name and that it supports image editing with the references you gave.');
}

/**
 * ByteDance Doubao via Volcengine Ark (endpoint shape confirmed from
 * public docs): POST {base}/images/generations, default base
 * https://ark.cn-beijing.volces.com/api/v3, body { model, prompt, image,
 * response_format: 'url', watermark: false }.
 * Limitation: Ark reference images are normally URLs; data URLs are sent
 * here and may be rejected by some models — the provider error is shown
 * as-is. For reliable references, use a publicly reachable image URL.
 */
async function generateDoubao(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  const base = (settings.baseUrl || '').trim();
  const apiBase = base && base !== 'http://127.0.0.1:8188' ? base.replace(/\/$/, '') : 'https://ark.cn-beijing.volces.com/api/v3';
  const body: Record<string, unknown> = { model: settings.model, prompt, response_format: 'url', watermark: false };
  if (refs.length === 1) body.image = refs[0];
  else if (refs.length > 1) body.image = refs;
  const res = await fetch(`${apiBase}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(errText(res, text));
  const j = JSON.parse(text);
  const d = j.data?.[0];
  if (d?.url) return d.url;
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  throw new Error('Doubao returned no image. Check the model/endpoint ID and region base URL in Settings.');
}

/**
 * Local ComfyUI (user-supplied workflow). Flow: upload each reference
 * image to /upload/image, substitute them into LoadImage nodes in order,
 * substitute __PROMPT__ in any text field, submit to /prompt, poll
 * /history/{prompt_id}, then fetch the first output image via /view.
 * Without a workflow JSON, or if the workflow has no image output,
 * this throws a clear error instead of inventing a result.
 */
async function generateComfyUI(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  const base = settings.baseUrl.replace(/\/$/, '');
  if (!settings.workflowJson.trim()) {
    throw new Error('ComfyUI needs a workflow JSON in Settings (paste an exported .api.json workflow containing a __PROMPT__ placeholder).');
  }
  let workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  try {
    workflow = JSON.parse(settings.workflowJson);
  } catch {
    throw new Error('The ComfyUI workflow JSON in Settings is not valid JSON.');
  }
  const uploaded: string[] = [];
  for (const [i, ref] of refs.entries()) {
    const { mime, b64 } = await dataUrlToMimeAndB64(ref);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: mime }), `ref-${i}.png`);
    const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`ComfyUI upload failed (HTTP ${res.status}). Is ComfyUI running at ${base} with CORS enabled?`);
    const j = await res.json();
    uploaded.push(j.name);
  }
  let imgIdx = 0;
  const promptJson: Record<string, { class_type: string; inputs: Record<string, unknown> }> = JSON.parse(JSON.stringify(workflow));
  for (const node of Object.values(promptJson)) {
    if (node.class_type === 'LoadImage' && imgIdx < uploaded.length) {
      node.inputs.image = uploaded[imgIdx++];
    }
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === 'string' && v.includes('__PROMPT__')) node.inputs[k] = v.replaceAll('__PROMPT__', prompt);
    }
  }
  const submit = await fetch(`${base}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: promptJson }),
  });
  if (!submit.ok) throw new Error(`ComfyUI /prompt failed (HTTP ${submit.status}). Check the workflow and that ComfyUI is running.`);
  const { prompt_id } = await submit.json();
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const hist = await fetch(`${base}/history/${prompt_id}`);
    if (!hist.ok) continue;
    const j = await hist.json();
    const entry = j[prompt_id];
    if (!entry) continue;
    if (entry.status?.messages?.some((m: unknown[]) => m[0] === 'execution_error')) {
      throw new Error('ComfyUI reported an execution error for this workflow.');
    }
    for (const out of Object.values(entry.outputs ?? {}) as { images?: { filename: string; subfolder?: string; type?: string }[] }[]) {
      const img = out.images?.[0];
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        return `${base}/view?${q.toString()}`;
      }
    }
  }
  throw new Error('ComfyUI did not finish within 4 minutes. Check the ComfyUI queue.');
}

export async function generateImage(settings: Settings, prompt: string, refs: string[]): Promise<string> {
  if (!settings.apiKey && settings.provider !== 'comfyui') {
    throw new Error('No API key set. Add your own key in Settings — it stays in this browser.');
  }
  switch (settings.provider) {
    case 'gemini': return generateGemini(settings, prompt, refs);
    case 'openai': return generateOpenAI(settings, prompt, refs);
    case 'qwen': return generateQwen(settings, prompt, refs);
    case 'doubao': return generateDoubao(settings, prompt, refs);
    case 'comfyui': return generateComfyUI(settings, prompt, refs);
  }
}
