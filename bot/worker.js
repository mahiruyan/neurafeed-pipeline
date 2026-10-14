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

// Reads a posting time Mahir writes in a Telegram note, in Turkey time unless he says NY.
// "21:30", "21.30'da", "saat 21", "yarın 10:00", "tomorrow 9:15", "NY 18:00". Returns ISO or null.
function tzOffsetMinutes(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}
function postAtFrom(note, now = new Date()) {
  const t = String(note || '').toLocaleLowerCase('tr');
  const m = t.match(/(?:saat\s*)(\d{1,2})(?:[:.](\d{2}))?|(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1] ?? m[3]);
  const min = Number(m[2] ?? m[4] ?? 0);
  if (h > 23 || min > 59) return null;
  const tz = /\b(ny|new york|amerika)\b/.test(t) ? 'America/New_York' : 'Europe/Istanbul';
  const off = tzOffsetMinutes(tz, now);
  const local = new Date(now.getTime() + off * 60000); // wall clock in tz, as UTC fields
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, min) - off * 60000;
  if (/(yarın|yarin|tomorrow)/.test(t)) target += 864e5;
  else if (target < now.getTime() - 5 * 60000) target += 864e5; // time already passed today -> tomorrow
  return new Date(target).toISOString();
}

export default {
  // Every 5 minutes: if a post Mahir scheduled is due, ask GitHub to publish it now (any hour).
  async scheduled(event, env, ctx) {
    if (event.cron === '0 17 * * SUN') ctx.waitUntil(weeklyReview(env).catch((e) => send(env, `⚠️ Haftalık hafıza gözden geçirmesi hata verdi: ${e.message}`)));
    else ctx.waitUntil(dueCheck(env));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/webhook') return new Response('NeuraFeed bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    const update = await req.json();
    ctx.waitUntil(handle(update, env).catch((e) => {
      const hint = /GitHub 40[13]/.test(e.message) ? '\nGitHub izni eksik görünüyor: neurafeed-bot anahtarında Contents izni "Read and write" olmalı. Düzeltince aynı butona tekrar basabilirsin, öneri bekliyor.' : '';
      return tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `⚠️ Bot hatası: ${e.message}${hint}`.slice(0, 3000) });
    }));
    return new Response('ok');
  },
};

async function handle(u, env) {
  const owner = String(env.OWNER_CHAT_ID);
  const cb = u.callback_query;
  if (cb) {
    if (String(cb.message?.chat?.id) !== owner) return;
    const [action, id] = String(cb.data || '').split(':');
    if (action === 'mdel') {
      await writeMemory(env, 'delete', { id });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Silindi' });
      await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return send(env, '🗑 Hafızadan silindi.', cb.message.message_id);
    }
    if (action === 'mdo' || action === 'mundo') {
      const raw = await env.KV.get(`mem:${id}`);
      if (!raw) return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Süresi doldu, tekrar iste' });
      if (action === 'mundo') { await env.KV.delete(`mem:${id}`); return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Kaydetmedim' }); }
      const p = JSON.parse(raw);
      const count = await writeMemory(env, p.op, p);
      await env.KV.delete(`mem:${id}`);
      await env.KV.delete('last_pending');
      await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Kaydedildi' });
      return send(env, p.op === 'delete' ? `🧠 Hafızadan silindi (${count}/50).` : `🧠 Hafızaya yazıldı (${count}/50). Hem ben hem Claude bundan sonra buna göre çalışacağız.`, cb.message.message_id);
    }
    if (action === 'do' || action === 'undo') {
      const raw = await env.KV.get(`act:${id}`);
      if (!raw) return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Süresi doldu, tekrar iste' });
      if (action === 'undo') { await env.KV.delete(`act:${id}`); return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Vazgeçildi' }); }
      const a = JSON.parse(raw);
      await queueAction(env, a.action, a.id, a.value);
      await env.KV.delete(`act:${id}`);
      await env.KV.delete('last_pending');
      await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Tamam' });
      return send(env, `👍 İşleme alındı (${a.action}: ${a.id}). 1-2 dakika içinde uygulanır.`, cb.message.message_id);
    }
    if (!['ok', 'no'].includes(action) || !id) return;
    await queueAction(env, action, id);
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
    const note = text.replace(URL_RE, '').trim();
    const day = new Date(m.date * 1000).toISOString().slice(0, 10);
    const all = [...new Set(urls.map((x) => x.replace(/[).,]+$/, '')))];
    for (const [i, url] of all.entries()) {
      await queueLink(env, { id: `link-${day}-${m.message_id}${all.length > 1 ? `-${i + 1}` : ''}`, url, note, format: formatOf(note), post_at: postAtFrom(note, new Date(m.date * 1000)), received_at: new Date(m.date * 1000).toISOString() });
    }
    const at = postAtFrom(note, new Date(m.date * 1000));
    const when = at ? `${new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye saati), günlük limitten ayrı` : 'ilk uygun Amerika saatinde';
    return send(env, `✅ Aldım. Format: ${FORMAT_TR[formatOf(note)]}.\nClaude en geç 2 saat içinde hazırlayacak, önizlemesini buraya atacağım. Onaylarsan ${when} paylaşılır.`, m.message_id);
  }
  if (!text) return;
  if (text === '/start' || text === '/help') {
    return send(env, 'Selam Mahir 👋\n• Link at: posta çevireyim (reel, carousel, tekli, prompt kelimelerinden birini ekleyebilirsin, "başlık: ..." da yazabilirsin, "21:30" ya da "yarın 10:00" yazarsan o saatte paylaşırım)\n• /durum: kuyruk ve bugünün postları\n• /rapor: son postların performansı\n• /hafiza: kalıcı hafızayı gör ve sil\n• /unut: sohbet geçmişini sıfırla\n• "Bunu hatırla: ..." ya da "kural: ..." yazarsan kalıcı hafızaya eklerim (sen onaylarsan)\n• Ya da bana normal yaz: "Fitbit postunu iptal et", "Gemini haberini şimdi paylaş", "Amazon postunu yarın 20:00\'ye ertele" gibi.', m.message_id);
  }
  const yes = /^(evet|onay|onayl|tamam|ok|olur|kaydet|yap)/i.test(text.trim().toLocaleLowerCase('tr')) && text.trim().length < 25;
  if (yes) {
    const last = await env.KV.get('last_pending');
    if (last) {
      const [kind, key] = last.split(':');
      return handle({ callback_query: { id: 'typed', data: `${kind}:${key}`, message: { chat: { id: owner }, message_id: m.message_id } } }, env);
    }
  }
  if (text === '/unut') { await env.KV.delete('history'); return send(env, 'Sohbet geçmişini sıfırladım (uzun süreli hafıza duruyor, onu /hafiza ile yönetirsin).', m.message_id); }
  if (text === '/hafiza' || text === '/hafıza') return showMemory(env, m.message_id);
  await tg(env, 'sendChatAction', { chat_id: owner, action: 'typing' }).catch(() => {});
  const question = text === '/durum' ? 'Kuyrukta ne var, bugün neler paylaşıldı, sırada ne var? Kısa listele.'
    : text === '/rapor' ? 'Son postların performansını analiz et: en iyi ve en kötü giden 3 post, neden, ve yarın için 3 somut öneri.'
    : text;
  const answer = await chat(env, question);
  return send(env, answer, m.message_id);
}

// ---------- Chat with memory and tools ----------
const HISTORY = 25;
const TOOLS = [
  { name: 'get_queue', description: 'Post queue for the last 4 days: id, status (approved=waiting, posted, pending=needs Mahir OK, canceled, rejected, expired, skipped, publish_failed), posted_at, post_at (scheduled time), priority, headline, from_link.', parameters: { type: 'object', properties: {} } },
  { name: 'get_instagram_stats', description: 'Last 12 Instagram posts with time, type, likes, comments, reach, views, saved, shares, title.', parameters: { type: 'object', properties: {} } },
  { name: 'propose_action', description: 'Prepare an action on one queued post. Mahir must confirm it with a button before it runs, so call this whenever he asks to cancel, post now, reschedule, change priority, approve or reject a post. Call get_queue first to find the exact id.', parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['cancel', 'post_now', 'reschedule', 'priority', 'approve', 'reject'] },
    id: { type: 'string', description: 'Exact job id from get_queue' },
    time: { type: 'string', description: 'For reschedule: time as Mahir said it, in Turkey time unless he said NY, like "21:30", "yarın 10:00", "NY 18:00"' },
    priority: { type: 'integer', enum: [1, 2, 3] },
  }, required: ['action', 'id'] } },
  { name: 'propose_memory', description: 'Save, update or delete a long-term memory note (editorial preference, standing instruction, past decision, operational fact) that both this assistant and the Claude news desk follow. Mahir confirms with a button. Use it when he asks you to remember something, sets a rule ("from now on", "always", "never", "kural", "hatırla", "unutma"), or explains a lasting reason for a decision. Not for small talk. Before adding, compare with the current memory: if a note covers the same thing, use op "replace" with its id; if a new rule contradicts an old one, replace the old one. For temporary instructions ("this week", "until Sunday") set expires_at.', parameters: { type: 'object', properties: {
    op: { type: 'string', enum: ['add', 'replace', 'delete'] },
    id: { type: 'string', description: 'Existing note id, for replace or delete' },
    category: { type: 'string', enum: ['editorial', 'rule', 'decision', 'ops'] },
    text: { type: 'string', description: 'The note, one clear sentence in English, specific enough for the news desk to apply' },
    expires_at: { type: 'string', description: 'YYYY-MM-DD for temporary notes, else omit' },
    why: { type: 'string', description: 'Short reason in Turkish, shown to Mahir' },
  }, required: ['op'] } },
].map((f) => ({ type: 'function', function: f }));

const CAT_TR = { editorial: 'Editoryal tercih', rule: 'Kalıcı talimat', decision: 'Geçmiş karar', ops: 'Operasyonel bilgi' };
async function loadMemory(env) {
  return cached(env, 'mem', 300, async () => {
    const res = await gh(env, 'contents/memory/notes.json', { headers: { Accept: 'application/vnd.github.raw' } }).catch(() => null);
    return res ? await res.text() : '[]';
  });
}
async function showMemory(env, replyTo) {
  const notes = JSON.parse(await loadMemory(env)).filter((n) => !n.expires_at || n.expires_at >= new Date().toISOString().slice(0, 10));
  if (!notes.length) return send(env, 'Hafıza boş. "Bunu hatırla: ..." diye yazarak ekleyebilirsin.', replyTo);
  await send(env, `🧠 Kalıcı hafıza (${notes.length}/50). Silmek için altındaki butona bas.`, replyTo);
  for (const [cat, title] of Object.entries(CAT_TR)) {
    for (const n of notes.filter((x) => x.category === cat)) {
      await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `${title}: ${n.text}${n.expires_at ? `\n(${n.expires_at} tarihine kadar)` : ''}`, reply_markup: { inline_keyboard: [[{ text: '🗑 Sil', callback_data: `mdel:${n.id}` }]] } });
    }
  }
}
async function proposeMemory(env, p) {
  const key = crypto.randomUUID().slice(0, 8);
  await env.KV.put(`mem:${key}`, JSON.stringify(p), { expirationTtl: 7 * 86400 });
  await env.KV.put('last_pending', `mdo:${key}`, { expirationTtl: 3600 });
  const head = p.op === 'delete' ? '🧠 Hafızadan silinsin mi?' : p.op === 'replace' ? '🧠 Hafızadaki bir maddeyi güncelleyeyim mi?' : '🧠 Hafızaya ekleyeyim mi?';
  const body = p.op === 'delete' ? p.id : `${CAT_TR[p.category] || p.category}: ${p.text}${p.expires_at ? `\n(${p.expires_at} tarihine kadar)` : ''}`;
  await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `${head}\n${body}${p.why ? `\nNeden: ${p.why}` : ''}`, reply_markup: { inline_keyboard: [[{ text: '✅ Evet', callback_data: `mdo:${key}` }, { text: '❌ Hayır', callback_data: `mundo:${key}` }]] } });
}

async function cached(env, key, ttl, fn) {
  const hit = await env.KV.get(key);
  if (hit) return hit;
  const v = await fn();
  await env.KV.put(key, v, { expirationTtl: ttl });
  return v;
}

async function runTool(env, name, args) {
  if (name === 'get_queue') return cached(env, 'queue', 300, () => queueSummary(env));
  if (name === 'get_instagram_stats') return cached(env, 'ig', 600, () => igSummary(env));
  if (name === 'propose_memory') {
    await proposeMemory(env, { op: args.op || 'add', id: args.id, category: args.category, text: args.text, expires_at: args.expires_at, source: `telegram ${new Date().toISOString().slice(0, 10)}`, why: args.why });
    return 'A confirmation with buttons was sent to Mahir. Tell him in one short sentence to confirm with the button.';
  }
  if (name === 'propose_action') {
    const value = args.action === 'reschedule' ? postAtFrom(args.time || '') : args.action === 'priority' ? String(args.priority || 2) : '';
    if (args.action === 'reschedule' && !value) return 'Could not read the time. Ask Mahir for a clear time like 21:30.';
    const key = crypto.randomUUID().slice(0, 8);
    await env.KV.put(`act:${key}`, JSON.stringify({ action: args.action, id: args.id, value }), { expirationTtl: 3600 });
    await env.KV.put('last_pending', `do:${key}`, { expirationTtl: 3600 });
    const NAMES = { cancel: 'İptal et', post_now: 'Şimdi paylaş', reschedule: 'Ertele', priority: 'Önceliği değiştir', approve: 'Onayla', reject: 'Reddet' };
    const extra = args.action === 'reschedule' ? `\nYeni saat: ${new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye)` : args.action === 'priority' ? `\nYeni öncelik: ${value}` : '';
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `${NAMES[args.action]}: ${args.id}${extra}\nOnaylıyor musun?`, reply_markup: { inline_keyboard: [[{ text: '✅ Evet', callback_data: `do:${key}` }, { text: '❌ Vazgeç', callback_data: `undo:${key}` }]] } });
    return 'Confirmation buttons were sent to Mahir. Tell him briefly to confirm with the button.';
  }
  return 'unknown tool';
}

async function chat(env, question) {
  const history = JSON.parse((await env.KV.get('history')) || '[]');
  const memory = await loadMemory(env).catch(() => '[]');
  const ny = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const tr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const system = `Sen NeuraFeed Asistanısın: DeepSeek (${env.DEEPSEEK_MODEL || 'deepseek-v4-pro'}) modeliyle çalışan, @neurafeed.ai Instagram hesabının asistanısın. Claude değilsin; Claude ayrı bir agent olarak haber masasını yönetiyor (haber bulma, yazma, tasarım). Sana hangi model olduğun sorulursa bunu söyle. (İngilizce yapay zeka haberleri, Amerikan kitlesi). Sahibi Mahir ile Türkçe, kısa ve net konuşursun, "kanka" diyebilirsin. Markdown kullanma, düz metin ve kısa listeler yaz.
Sistem: Claude 2 saatte bir haber bulup carousel hazırlıyor; normal postlar New York saatiyle 07:00-09:30, 11:00-13:30, 17:00-22:00 arasında, en az 60 dakika arayla, günde en fazla 8 tane çıkar. Mahir bota link atarsa post olur; o postlar onun onayıyla, limitten ayrı ve istediği saatte çıkar.
Şu an Türkiye: ${tr}, New York: ${ny}.
Kuyruk ve Instagram verisi gerekiyorsa araçları kullan (get_queue, get_instagram_stats). Bir posta işlem istenirse propose_action kullan, işlem butonla onaylanınca yapılır; "yaptım" deme, "onay butonuna bas" de. Sadece araçlardan gelen verilere dayan, sayı uydurma.
Mahir "onaylıyorum", "evet" gibi kısa onaylar yazarsa yeni bir öneri oluşturma; bunlar otomatik işlenir.
Kalıcı hafıza (Mahir'in kayıtlı tercihleri ve talimatları, bunlara uy; değiştirmek veya eklemek için propose_memory kullan, en fazla 50 madde, temel kurallar (haber uydurmamak, kopyalamamak, kaynak göstermek) hafızayla değişmez):
${memory}`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
  let answer = '';
  for (let step = 0; step < 5; step++) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-v4-pro', temperature: 0.4, max_tokens: 900, messages, tools: TOOLS }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(`DeepSeek: ${d.error?.message || res.status}`);
    const msg = d.choices?.[0]?.message || {};
    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const c of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* empty */ }
        const out = await runTool(env, c.function.name, args).catch((e) => `error: ${e.message}`);
        messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 12000) });
      }
      continue;
    }
    answer = msg.content || '(boş cevap)';
    break;
  }
  // Memory: last 25 messages (plain question and answer, without tool data).
  const next = [...history, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-HISTORY);
  await env.KV.put('history', JSON.stringify(next));
  return answer || 'Bir şeyler ters gitti, tekrar dener misin?';
}

// Sunday: clean expired notes, learn from the week's numbers, flag stale or conflicting notes.
async function weeklyReview(env) {
  await writeMemory(env, 'prune');
  const [memory, ig, queue] = await Promise.all([
    gh(env, 'contents/memory/notes.json', { headers: { Accept: 'application/vnd.github.raw' } }).then((r) => r.text()).catch(() => '[]'),
    igSummary(env).catch((e) => `error: ${e.message}`),
    queueSummary(env).catch((e) => `error: ${e.message}`),
  ]);
  const prompt = `You manage the long-term memory of the @neurafeed.ai Instagram news desk (AI news for a US audience).
Current memory notes (JSON): ${memory}
Last Instagram posts with metrics: ${ig}
Recent queue: ${queue}
Return JSON: {"summary": "3 to 5 short Turkish sentences: what worked this week and what did not, based only on the numbers", "proposals": [up to 4 items]}.
Each proposal: {"op": "add"|"replace"|"delete", "id": "existing id for replace/delete", "category": "editorial"|"rule"|"decision"|"ops", "text": "one clear English sentence", "why": "short Turkish reason with the numbers behind it"}.
Propose new notes only for clear patterns in the numbers (topics, headline styles, formats, posting times). Propose delete or replace for notes that are expired in spirit, duplicated or contradicting. No proposals if nothing is clear.`;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-v4-pro', temperature: 0.3, max_tokens: 1200, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`DeepSeek: ${d.error?.message || res.status}`);
  const out = JSON.parse(d.choices?.[0]?.message?.content || '{}');
  await send(env, `📊 Haftalık hafıza gözden geçirmesi\n\n${out.summary || 'Bu hafta net bir şey çıkmadı.'}${out.proposals?.length ? '\n\nÖnerilerim aşağıda, istediklerini onayla:' : ''}`);
  for (const p of (out.proposals || []).slice(0, 4)) await proposeMemory(env, { ...p, source: `weekly review ${new Date().toISOString().slice(0, 10)}` });
}

async function dueCheck(env) {
  const res = await gh(env, 'contents/inbox/links.json', { headers: { Accept: 'application/vnd.github.raw' } }).catch(() => null);
  if (!res) return;
  const list = await res.json().catch(() => []);
  const now = Date.now();
  // Due in the last 10 minutes: two ticks at most, and the publish step is safe to repeat.
  if (list.some((l) => l.post_at && Date.parse(l.post_at) <= now && Date.parse(l.post_at) > now - 10 * 60000)) {
    await dispatch(env, 'poll.yml', {});
  }
}


// ---------- Locked writes to the repo ----------
// Reads the files at the current commit, lets `change` edit them, and commits all of them in one
// commit. The branch only moves if nobody else pushed in between (force: false); otherwise it
// reads again and retries. So two writes can never overwrite each other.
async function commitFiles(env, paths, change, message) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const ref = await (await gh(env, 'git/ref/heads/main')).json();
    const head = ref.object.sha;
    const commit = await (await gh(env, `git/commits/${head}`)).json();
    const current = {};
    for (const p of paths) {
      const r = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${p}?ref=${head}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'neurafeed-bot', Accept: 'application/vnd.github.raw' } });
      current[p] = r.ok ? await r.text() : null;
    }
    const next = await change(current);
    if (!next) return null;
    const tree = await (await gh(env, 'git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: Object.entries(next).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) }) })).json();
    const created = await (await gh(env, 'git/commits', { method: 'POST', body: JSON.stringify({ message: `${message} [skip ci]`, tree: tree.sha, parents: [head] }) })).json();
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'neurafeed-bot', Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ sha: created.sha, force: false }),
    });
    if (res.ok) return next;
    if (res.status !== 422 && res.status !== 409) throw new Error(`GitHub commit ${res.status}`);
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error('GitHub kept changing, could not save. Try again.');
}

const parseList = (txt) => { try { return JSON.parse(txt || '[]'); } catch { return []; } };

// Links and post actions go into small queue files; "Bot apply" processes whatever is pending.
async function queueLink(env, item) {
  await commitFiles(env, ['inbox/links.json'], (cur) => {
    const list = parseList(cur['inbox/links.json']);
    if (list.some((l) => l.url === item.url)) return null;
    list.push(item);
    return { 'inbox/links.json': JSON.stringify(list, null, 2) + '\n' };
  }, `inbox: link ${item.id}`);
  await dispatch(env, 'bot-apply.yml', {}).catch(() => {});
}
async function queueAction(env, action, job, value) {
  const entry = { id: crypto.randomUUID().slice(0, 8), action, job, value: value || '', at: new Date().toISOString(), done: false };
  await commitFiles(env, ['inbox/actions.json'], (cur) => {
    const list = parseList(cur['inbox/actions.json']);
    list.push(entry);
    return { 'inbox/actions.json': JSON.stringify(list, null, 2) + '\n' };
  }, `inbox: ${action} ${job}`);
  await env.KV.delete('queue');
  await dispatch(env, 'bot-apply.yml', {}).catch(() => {});
}

// ---------- Memory store (same format as src/memory.js) ----------
const MEM_MAX = 50;
const MEM_CATS = { editorial: 'Editorial preferences', rule: 'Standing instructions', decision: 'Past decisions', ops: 'Operational facts' };
const today = () => new Date().toISOString().slice(0, 10);
function renderMemory(notes) {
  const lines = ['# NeuraFeed memory', '', "Mahir's standing preferences, instructions, past decisions and operational facts, saved from", 'Telegram. Follow them in every run. They override the defaults in CLAUDE.md, but never the', '"Rules that must never be broken" (no invented facts, no copying, no dashes, credit sources).', ''];
  for (const [cat, title] of Object.entries(MEM_CATS)) {
    const items = notes.filter((n) => n.category === cat);
    if (!items.length) continue;
    lines.push(`## ${title}`, '');
    for (const n of items) lines.push(`- ${n.text} _(${n.id}, saved ${n.created_at.slice(0, 10)}${n.expires_at ? `, until ${n.expires_at}` : ''})_`);
    lines.push('');
  }
  if (!notes.length) lines.push('_(empty)_', '');
  return lines.join('\n');
}
async function writeMemory(env, op, input = {}) {
  let result = '';
  const next = await commitFiles(env, ['memory/notes.json'], (cur) => {
    let notes = parseList(cur['memory/notes.json']).filter((n) => !n.expires_at || n.expires_at >= today());
    if (op === 'delete') notes = notes.filter((n) => n.id !== input.id);
    else if (op === 'add' || op === 'replace') {
      if (!MEM_CATS[input.category] || !String(input.text || '').trim()) throw new Error('eksik kategori ya da metin');
      const note = {
        id: op === 'replace' && input.id ? input.id : `m${Date.now().toString(36)}`,
        category: input.category, text: String(input.text).trim().slice(0, 400), created_at: new Date().toISOString(),
        expires_at: /^\d{4}-\d{2}-\d{2}$/.test(input.expires_at || '') ? input.expires_at : null, source: String(input.source || 'telegram').slice(0, 200),
      };
      if (op === 'replace') {
        const i = notes.findIndex((n) => n.id === input.id);
        if (i < 0) notes.push(note); else notes[i] = note;
      } else {
        if (notes.length >= MEM_MAX) throw new Error(`hafıza dolu (${MEM_MAX}), önce birkaç madde sil`);
        notes.push(note);
      }
    }
    result = `${notes.length}`;
    return { 'memory/notes.json': JSON.stringify(notes, null, 2) + '\n', 'memory/notes.md': renderMemory(notes) };
  }, `memory: ${op}`);
  // The bot sees its own write at once.
  if (next) await env.KV.put('mem', next['memory/notes.json'], { expirationTtl: 300 });
  return result;
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
  const res = await gh(env, 'contents/state/summary.json', { headers: { Accept: 'application/vnd.github.raw' } });
  return await res.text();
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

// ---------- Telegram ----------
async function tg(env, method, body) {
  if (method === 'answerCallbackQuery' && body.callback_query_id === 'typed') return null;
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
