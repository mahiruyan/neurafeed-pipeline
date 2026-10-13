// NeuraFeed Telegram bot (Cloudflare Worker, webhook).
// - Links from Mahir  -> GitHub "inbox" workflow (turned into posts by the Claude news desk)
// - Approve / Reject buttons -> GitHub "decide" workflow
// - Anything else -> chat with DeepSeek, which sees the post queue and Instagram numbers
// Secrets: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, DEEPSEEK_API_KEY, GH_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const word = (w) => new RegExp(`(^|[^\\p{L}])(${w})(?=$|[^\\p{L}])`, 'u');
const FORMATS = [
  ['reel', word('reel\\p{L}*')],
  ['single', word('tekli(?!f)\\p{L}*|single')],
  ['prompt', word('prompt\\p{L}*|promt\\p{L}*')],
  ['carousel', word('carousel\\p{L}*|karusel\\p{L}*|karosel\\p{L}*')],
];
const formatOf = (t) => (FORMATS.find(([, re]) => re.test(String(t || '').toLocaleLowerCase('tr'))) || ['auto'])[0];
const FORMAT_TR = {
  reel: 'Reels', single: 'tekli post', prompt: 'prompt carousel', carousel: 'haber carousel',
  auto: 'video ise Reels, değilse haber carousel',
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/webhook') return new Response('NeuraFeed bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    const update = await req.json();
    ctx.waitUntil(handle(update, env).catch((e) => tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `⚠️ Bot hatası: ${e.message}`.slice(0, 3000) })));
    return new Response('ok');
  },
};

async function handle(u, env) {
  const owner = String(env.OWNER_CHAT_ID);
  const cb = u.callback_query;
  if (cb) {
    if (String(cb.message?.chat?.id) !== owner) return;
    const [action, id] = String(cb.data || '').split(':');
    if (!['ok', 'no'].includes(action) || !id) return;
    await dispatch(env, 'decide.yml', { id, action });
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: action === 'ok' ? 'Onaylandı' : 'Reddedildi' });
    await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await send(env, action === 'ok' ? `✅ Onaylandı: ${id}\nİlk uygun Amerika saatinde paylaşılacak.` : `❌ Reddedildi: ${id}`, cb.message.message_id);
    return;
  }
  const m = u.message;
  if (!m || String(m.chat?.id) !== owner) return;
  const text = [m.text, m.caption].filter(Boolean).join('\n');
  const extra = [...(m.entities || []), ...(m.caption_entities || [])].filter((e) => e.type === 'text_link').map((e) => e.url);
  const urls = [...(text.match(URL_RE) || []), ...extra];

  if (urls.length) {
    await dispatch(env, 'inbox.yml', { text, extra_urls: extra.join(' '), message_id: String(m.message_id), date: String(m.date) });
    const note = text.replace(URL_RE, '');
    return send(env, `✅ Aldım. Format: ${FORMAT_TR[formatOf(note)]}.\nClaude en geç 2 saat içinde hazırlayacak, önizlemesini buraya atacağım. Onaylarsan ilk uygun Amerika saatinde paylaşılır.`, m.message_id);
  }
  if (!text) return;
  if (text === '/start' || text === '/help') {
    return send(env, 'Selam Mahir 👋\n• Link at: posta çevireyim (reel, carousel, tekli, prompt kelimelerinden birini ekleyebilirsin, "başlık: ..." da yazabilirsin)\n• /durum: kuyruk ve bugünün postları\n• /rapor: son postların performansı\n• Ya da bana istediğini sor.', m.message_id);
  }
  await tg(env, 'sendChatAction', { chat_id: owner, action: 'typing' }).catch(() => {});
  const question = text === '/durum' ? 'Kuyrukta ne var, bugün neler paylaşıldı, sırada ne var? Kısa listele.'
    : text === '/rapor' ? 'Son postların performansını analiz et: en iyi ve en kötü giden 3 post, neden, ve yarın için 3 somut öneri.'
    : text;
  const [queue, ig] = await Promise.all([queueSummary(env).catch((e) => `queue error: ${e.message}`), igSummary(env).catch((e) => `instagram error: ${e.message}`)]);
  const answer = await deepseek(env, question, queue, ig);
  return send(env, answer, m.message_id);
}

// ---------- GitHub ----------
async function gh(env, path, init = {}) {
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN eksik');
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'neurafeed-bot', Accept: 'application/vnd.github+json', ...(init.headers || {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`GitHub ${res.status} ${path}`);
  return res;
}
const dispatch = (env, wf, inputs) => gh(env, `actions/workflows/${wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });

async function queueSummary(env) {
  const list = await (await gh(env, 'contents/state/jobs')).json();
  const recent = list.filter((f) => /^\d{4}-\d{2}-\d{2}-/.test(f.name)).map((f) => f.name).sort().slice(-14);
  const states = await Promise.all(recent.map(async (n) => {
    const s = await (await gh(env, `contents/state/jobs/${n}`, { headers: { Accept: 'application/vnd.github.raw' } })).json();
    return { id: s.id, status: s.status, posted_at: s.posted_at || null, by: s.by || null, error: s.status === 'posted' ? null : (s.error || null) };
  }));
  return JSON.stringify(states);
}

// ---------- Instagram ----------
async function igSummary(env) {
  const base = 'https://graph.instagram.com';
  const t = encodeURIComponent(env.IG_ACCESS_TOKEN);
  const media = await (await fetch(`${base}/${env.IG_USER_ID}/media?fields=id,caption,timestamp,like_count,comments_count,media_product_type,permalink&limit=12&access_token=${t}`)).json();
  if (media.error) throw new Error(media.error.message);
  const rows = await Promise.all((media.data || []).map(async (p) => {
    const ins = await (await fetch(`${base}/${p.id}/insights?metric=reach,views,saved,shares,total_interactions&access_token=${t}`)).json().catch(() => ({}));
    const metrics = {};
    for (const d of ins.data || []) metrics[d.name] = d.values?.[0]?.value ?? d.total_value?.value;
    return {
      time: p.timestamp, type: p.media_product_type, likes: p.like_count, comments: p.comments_count, ...metrics,
      title: String(p.caption || '').split('\n')[0].slice(0, 110), url: p.permalink,
    };
  }));
  return JSON.stringify(rows);
}

// ---------- DeepSeek ----------
async function deepseek(env, question, queue, ig) {
  const now = new Date();
  const ny = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const system = `Sen @neurafeed.ai Instagram hesabının asistanısın (İngilizce yapay zeka haberleri, Amerikan kitlesi). Sahibi Mahir ile Türkçe, kısa ve net konuşursun, "kanka" diyebilirsin. Markdown kullanma, düz metin ve kısa listeler yaz.
Sistem: Claude 2 saatte bir haber bulup carousel hazırlıyor; paylaşımlar sadece New York saatiyle 07:00-09:30, 11:00-13:30, 17:00-22:00 arasında, en az 60 dakika arayla, günde en fazla 8 post. Mahir bota link atarsa post olur.
Şu an: ${now.toISOString()} (New York: ${ny}).
Kuyruk (state/jobs, status: approved=sırada, posted=paylaşıldı, pending=onay bekliyor, skipped/expired=atlandı, publish_failed=hata):
${queue}
Son Instagram postları ve metrikleri (reach=erişim, views=görüntülenme, saved=kaydetme, shares=paylaşım):
${ig}
Sadece bu verilere dayan, sayı uydurma. Veri yoksa söyle. Analizde neyin işe yaradığını somut söyle (konu, başlık tarzı, format, saat).`;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.4, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: question }] }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`DeepSeek: ${d.error?.message || res.status}`);
  return d.choices?.[0]?.message?.content || '(boş cevap)';
}

// ---------- Telegram ----------
async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!d.ok) throw new Error(`Telegram ${method}: ${d.description}`);
  return d.result;
}
async function send(env, text, replyTo) {
  const chunks = String(text).match(/[\s\S]{1,3900}/g) || [''];
  for (const [i, c] of chunks.entries()) {
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: c, disable_web_page_preview: true, ...(i === 0 && replyTo ? { reply_parameters: { message_id: replyTo } } : {}) });
  }
}
