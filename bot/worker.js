// NeuraFeed Telegram bot (Cloudflare Worker, webhook).
// - Links from Mahir  -> GitHub "inbox" workflow (turned into posts by the Claude news desk)
// - Approve / Reject buttons -> GitHub "decide" workflow
// - Anything else -> chat with DeepSeek, which sees the post queue and Instagram numbers
// Secrets: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, DEEPSEEK_API_KEY, GH_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID,
// THREADS_TOKEN, FB_PAGE_TOKEN (a system user token; the page token is looked up through it)

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
    if (event.cron === '0 7 * * MON') return ctx.waitUntil(dispatch(env, 'report.yml', { days: '7', send: 'true' }));
    if (event.cron === '0 7 1 * *') return ctx.waitUntil(dispatch(env, 'report.yml', { days: '30', send: 'true' }));
    if (event.cron === '0 17 * * SUN') ctx.waitUntil(weeklyReview(env).catch((e) => send(env, `⚠️ Haftalık hafıza gözden geçirmesi hata verdi: ${e.message}`)));
    else {
      ctx.waitUntil(dueCheck(env));
      ctx.waitUntil(siteDraftCheck(env).catch((e) => console.log(`site drafts: ${e.message}`)));
    }
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/webhook') return new Response('NeuraFeed bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    const update = await req.json();
    // Telegram retries an update it thinks failed: handle each one only once.
    const seen = `upd:${update.update_id}`;
    if (await env.KV.get(seen)) return new Response('ok');
    await env.KV.put(seen, '1', { expirationTtl: 3600 });
    // Answer Telegram at once and do the work in the background queue (a Durable Object alarm may
    // run up to 15 minutes). Holding Telegram's request open made it give up ("Read timeout
    // expired") and Cloudflare then cut long answers off: the bot looked like it never replied.
    if (env.RUNNER) {
      await env.RUNNER.get(env.RUNNER.idFromName('main')).fetch('https://runner/enqueue', { method: 'POST', body: JSON.stringify(update) });
      return new Response('ok');
    }
    const work = run(update, env);
    ctx.waitUntil(work);
    await work;
    return new Response('ok');
  },
};

// One background worker for all of Mahir's messages, in the order they came in.
export class Runner {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const update = await req.json();
    const q = (await this.state.storage.get('q')) || [];
    q.push(update);
    await this.state.storage.put('q', q);
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now());
    return new Response('queued');
  }
  async alarm() {
    for (let n = 0; n < 50; n++) {
      const q = (await this.state.storage.get('q')) || [];
      if (!q.length) return;
      const u = q.shift();
      // Taken off the queue before it runs: a crash can drop one message, never answer it twice.
      await this.state.storage.put('q', q);
      await run(u, this.env);
    }
  }
}

async function handle(u, env) {
  const owner = String(env.OWNER_CHAT_ID);
  const cb = u.callback_query;
  if (cb) {
    if (String(cb.message?.chat?.id) !== owner) return;
    if (String(cb.data || '').startsWith('wz:')) return wizardButton(env, cb);
    if (/^s[pr]:/.test(String(cb.data || ''))) return siteDraftButton(env, cb);
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
    if (action === 'rdo' || action === 'rundo') {
      const raw = await env.KV.get(`req:${id}`);
      if (!raw) return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Süresi doldu, tekrar iste' });
      await env.KV.delete('last_pending');
      if (action === 'rundo') { await env.KV.delete(`req:${id}`); return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Vazgeçildi' }); }
      const r = JSON.parse(raw);
      const rid = `req-${new Date().toISOString().slice(0, 10)}-${id}`;
      await commitFiles(env, ['inbox/requests.json'], (cur) => {
        const list = parseList(cur['inbox/requests.json']).filter((q) => Date.now() - new Date(q.created_at).getTime() < 14 * 864e5);
        if (list.some((q) => q.id === rid)) return null;
        list.push({ id: rid, ...r, created_at: new Date().toISOString() });
        return { 'inbox/requests.json': JSON.stringify(list, null, 2) + '\n' };
      }, `inbox: request ${rid}`);
      await env.KV.delete(`req:${id}`);
      await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Gönderildi' });
      const started = await startLinkDesk(env, [rid]);
      return send(env, started ? "📝 Claude'a iletildi, şimdi yapıyor. Sonucu buraya yazarım." : "📝 Claude'a iletildi. Bir sonraki çalışmasında yapacak, sonucu buraya yazarım.", cb.message.message_id);
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
    // Old preview buttons: do not say "approved" for a post that was replaced, canceled or already out.
    const st = JSON.parse((await repoFile(env, `state/jobs/${id}.json`).catch(() => null)) || 'null');
    if (st && st.status !== 'pending') {
      await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: `Bu post artık beklemede değil (${st.status})` });
      await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return send(env, `ℹ️ ${id} artık onay beklemiyor (durum: ${st.status}${st.history?.at(-1)?.by ? `, ${st.history.at(-1).by}` : ''}). Bir işlem yapmadım.`, cb.message.message_id);
    }
    await queueAction(env, action, id);
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: action === 'ok' ? 'Onaylandı' : 'Reddedildi' });
    await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    const job = action === 'ok' ? JSON.parse((await repoFile(env, `jobs/${id}.json`).catch(() => null)) || 'null') : null;
    const own = job && (job.post_at || (job.link_id && !job.us_window));
    const whenOk = !own ? 'İlk uygun Amerika saatinde paylaşılacak.'
      : job.post_at && new Date(job.post_at) > new Date() ? `${new Date(job.post_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye saati) paylaşılacak.`
      : 'Birkaç dakika içinde paylaşılıyor.';
    await send(env, action === 'ok' ? `✅ Onaylandı: ${id}\n${whenOk}` : `❌ Reddedildi: ${id}`, cb.message.message_id);
    return;
  }
  const m = u.message;
  if (!m || String(m.chat?.id) !== owner) return;
  const text = [m.text, m.caption].filter(Boolean).join('\n');
  // The step-by-step post wizard takes every message while it is open.
  const wiz = await wizGet(env);
  if (/^\/?(post|yeni post|\/yeni)$/i.test(text.trim())) return wizardStart(env, m.message_id);
  if (wiz && !/^\/(start|help|durum|unut|hafiza|hafıza)$/.test(text.trim())) return wizardInput(env, wiz, m, text);
  // A picture without a link: start the wizard as a single-image post.
  if (imageOf(m) && !(text.match(URL_RE) || []).length) return wizardStart(env, m.message_id, { format: 'single', image: imageOf(m), step: 'title' });
  const extra = [...(m.entities || []), ...(m.caption_entities || [])].filter((e) => e.type === 'text_link').map((e) => e.url);
  const urls = [...(text.match(URL_RE) || []), ...extra];

  if (urls.length) {
    const note = text.replace(URL_RE, '').trim();
    const day = new Date(m.date * 1000).toISOString().slice(0, 10);
    const all = [...new Set(urls.map((x) => x.replace(/[).,]+$/, '')))];
    const fresh = [];
    for (const [i, url] of all.entries()) {
      const id = `link-${day}-${m.message_id}${all.length > 1 ? `-${i + 1}` : ''}`;
      if (await queueLink(env, { id, url, note, format: formatOf(note), post_at: postAtFrom(note, new Date(m.date * 1000)), received_at: new Date(m.date * 1000).toISOString() })) fresh.push(id);
    }
    if (!fresh.length) return send(env, 'ℹ️ Bu link zaten sırada, ikinci kez eklemedim. Farklı bir formatta istiyorsan "post" yazıp adım adım hazırlayabilirsin.', m.message_id);
    const at = postAtFrom(note, new Date(m.date * 1000));
    const started = await startLinkDesk(env, fresh);
    const when = at ? `${new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye saati)` : (started ? 'hemen' : 'hemen, saatten bağımsız');
    const who = started ? 'Claude şimdi hazırlıyor, 5-10 dakikada önizlemesi gelir.' : `Claude ${trTime(nextDeskRun())} çalışmasında hazırlayacak, önizlemesini buraya atacağım.`;
    return send(env, `✅ Aldım. Format: ${FORMAT_TR[formatOf(note)]}.\n${who} Onaylarsan ${when} paylaşılır.`, m.message_id);
  }
  if (!text) return;
  if (text === '/start' || text === '/help') {
    return send(env, 'Selam Mahir 👋\n• post: adım adım yeni post (format, link ya da görsel, başlık, açıklama, saat butonlarla)\n• Görsel at: tekli post olarak hazırlayayım\n• Link at: posta çevireyim (reel, carousel, tekli, prompt kelimelerinden birini ekleyebilirsin, "başlık: ..." da yazabilirsin, "21:30" ya da "yarın 10:00" yazarsan o saatte paylaşırım)\n• /durum: kuyruk ve bugünün postları\n• /istatistik: Instagram, Threads ve Facebook son 7 gün yan yana (/istatistik 30 = aylık)\n• /rapor: son postların performansı (sohbet)\n• /pdf: son 7 günün PDF raporu (/pdf 14 = son 14 gün, /aylik = son 30 gün)\n• /hafiza: kalıcı hafızayı gör ve sil\n• /unut: sohbet geçmişini sıfırla\n• "Bunu hatırla: ..." ya da "kural: ..." yazarsan kalıcı hafızaya eklerim (sen onaylarsan)\n• Ya da bana normal yaz: "Fitbit postunu iptal et", "Gemini haberini şimdi paylaş", "Amazon postunu yarın 20:00\'ye ertele" gibi.', m.message_id);
  }
  // Only a bare "yes" confirms the last proposal, and only a recent one: "ok, fix this" is a new request.
  const yes = /^(evet|onay|onaylıyorum|onayliyorum|onayla|tamam|ok|okey|olur|kaydet|yap)[.! ]*$/i.test(text.trim().toLocaleLowerCase('tr'));
  if (yes) {
    const last = await env.KV.get('last_pending');
    if (last) {
      const [kind, key] = last.split(':');
      return handle({ callback_query: { id: 'typed', data: `${kind}:${key}`, message: { chat: { id: owner }, message_id: m.message_id } } }, env);
    }
  }
  if (text === '/unut') { await env.KV.delete('history'); return send(env, 'Sohbet geçmişini sıfırladım (uzun süreli hafıza duruyor, onu /hafiza ile yönetirsin).', m.message_id); }
  if (text === '/hafiza' || text === '/hafıza') return showMemory(env, m.message_id);
  // Three platforms side by side, computed here (no model math): /istatistik = 7 days, /istatistik 30 = monthly.
  if (/^\/(istatistik|stats)\b/i.test(text)) {
    const d = Math.min(90, Math.max(1, Number(text.split(/\s+/)[1]) || 7));
    await tg(env, 'sendChatAction', { chat_id: owner, action: 'typing' }).catch(() => {});
    const r = JSON.parse(await cached(env, `all${d}`, 1800, async () => JSON.stringify(await allPlatformStats(env, d))));
    return send(env, statsText(r), m.message_id);
  }
  if (/^\/(pdf|rapor_pdf|haftalik|haftalık|aylik|aylık)/.test(text)) {
    const d = /aylik|aylık/.test(text) ? 30 : Number(text.split(/\s+/)[1]) || 7;
    await dispatch(env, 'report.yml', { days: String(Math.min(90, Math.max(1, d))), send: 'true' });
    return send(env, `📊 ${d === 30 ? 'Aylık' : `Son ${d} günün`} PDF raporu hazırlanıyor, yaklaşık 3 dakikada burada.`, m.message_id);
  }
  await tg(env, 'sendChatAction', { chat_id: owner, action: 'typing' }).catch(() => {});
  const question = text === '/durum' ? 'Kuyrukta ne var, bugün neler paylaşıldı, sırada ne var? Kısa listele.'
    : text === '/rapor' ? 'Son postların performansını analiz et: en iyi ve en kötü giden 3 post, neden, ve yarın için 3 somut öneri.'
    : text;
  const answer = await chat(env, (await replyContext(env, m)) + question);
  return send(env, answer, m.message_id);
}

async function run(update, env) {
  const chat = update.message?.chat?.id;
  // Keep "typing..." visible while a long answer is being prepared.
  let alive = true;
  const typing = (async () => {
    while (alive && chat) {
      await tg(env, 'sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 4500));
    }
  })();
  try {
    await handle(update, env);
  } catch (e) {
    const hint = /GitHub 40[13]/.test(e.message) ? '\nGitHub izni eksik görünüyor: neurafeed-bot anahtarında Contents izni "Read and write" olmalı.' : '';
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `⚠️ Bot hatası: ${e.message}${hint}`.slice(0, 3000) }).catch(() => {});
  } finally {
    alive = false;
    await typing.catch(() => {});
  }
}

// ---------- Chat with memory and tools ----------
const HISTORY = 25;
const FINAL_NUDGE = 'Elindeki bilgilerle şimdi kısa ve net cevap ver, araç çağırma.';
const TOOLS = [
  { name: 'get_queue', description: 'Post queue for the last 4 days: id, status (approved=waiting, posted, pending=needs Mahir OK, canceled, rejected, expired, skipped, publish_failed), posted_at, post_at (scheduled time), priority, headline, from_link.', parameters: { type: 'object', properties: {} } },
  { name: 'get_links', description: "Links and pictures Mahir sent to the bot (last 10) and what happened to each: waiting for the news desk (with the time of the desk's next run), being prepared, the post it became (job id and status: pending = preview sent, waiting for his OK; approved = will post at post_at; posted) or skipped by the desk with the reason. Use it whenever he asks about a link he sent, a Reel, or whether something was shared.", parameters: { type: 'object', properties: {} } },
  { name: 'get_threads_stats', description: 'Threads account (@neurafeed.ai): total views, likes, replies, reposts, quotes and followers for the last N days, the change against the previous N days, and the top and weakest Threads posts by views.', parameters: { type: 'object', properties: { days: { type: 'integer', description: '1 to 90, default 7' } } } },
  { name: 'get_facebook_stats', description: 'Facebook page (neurafeed.ai): followers, views, reach, engagements, new follows, video views and page visits for the last N days, the change against the previous N days, and the top and weakest Facebook posts by views (with reactions, comments, shares, clicks).', parameters: { type: 'object', properties: { days: { type: 'integer', description: '1 to 90, default 7' } } } },
  { name: 'get_all_platform_stats', description: 'Instagram, Threads and Facebook side by side for the last N days (7 = weekly, 30 = monthly): combined views and followers, each platform\'s share of views, the change against the previous period, and each platform\'s best posts. Use it for any weekly, monthly or "all platforms" question.', parameters: { type: 'object', properties: { days: { type: 'integer', description: '7 for weekly, 30 for monthly, 1 to 90' } } } },
  { name: 'get_account_stats', description: 'Instagram account numbers: followers, number of posts, daily reach and follower change for the last days, where followers come from (countries, cities, age, gender) and where the accounts reached this week or month (viewers) come from (country, age).', parameters: { type: 'object', properties: { days: { type: 'integer', description: 'How many past days of reach and follower change, 1 to 30, default 7' } } } },
  { name: 'send_report', description: 'Create the PDF performance report (English, NeuraFeed design) and send it to Mahir on Telegram in about 3 minutes. Weekly = 7 days, monthly = 30 days, or any number of days. It compares with the previous period and the average of the last 4 periods.', parameters: { type: 'object', properties: { days: { type: 'integer', description: '7 weekly (default), 30 monthly, or 1 to 90' } } } },
  { name: 'get_instagram_stats', description: 'Stats for ALL Instagram posts of the account (every post since the start, not only the ones this system made): count, totals and averages, averages by format and by month, and the top and bottom posts by a metric. Filter by dates. Use it for any question about past posts or performance.', parameters: { type: 'object', properties: {
    from: { type: 'string', description: 'YYYY-MM-DD, optional' }, to: { type: 'string', description: 'YYYY-MM-DD, optional' },
    sort_by: { type: 'string', enum: ['views', 'reach', 'saved', 'shares', 'likes', 'comments', 'total_interactions'], description: 'default views' },
    top: { type: 'integer', description: 'How many top and bottom posts to list, default 8, max 20' },
    format: { type: 'string', enum: ['any', 'Reel', 'Carousel', 'Single image', 'Video'] },
  } } },
  { name: 'propose_action', description: 'Prepare an action on one queued post. Mahir must confirm it with a button before it runs, so call this whenever he asks to cancel, post now, reschedule, change priority, approve or reject a post. Call get_queue first to find the exact id.', parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['cancel', 'post_now', 'reschedule', 'priority', 'approve', 'reject'] },
    id: { type: 'string', description: 'Exact job id from get_queue' },
    time: { type: 'string', description: 'For reschedule: time as Mahir said it, in Turkey time unless he said NY, like "21:30", "yarın 10:00", "NY 18:00"' },
    priority: { type: 'integer', enum: [1, 2, 3] },
  }, required: ['action', 'id'] } },
  { name: 'get_post', description: 'Full content of one post the news desk made: format, priority, sources, caption, and every slide (headline, heading, paragraphs, CTA hook, image source, whether the cover is AI-generated and its prompt). Call get_queue first to find the exact id.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact job id' } }, required: ['id'] } },
  { name: 'get_desk_log', description: "The Claude news desk's run log: for each run, the stories it looked at, which it queued (with job id and priority), which it skipped or found already covered and why, and how it handled Mahir's requests. Also lists requests still waiting. Use it for questions like why a story was not posted, what Claude did today, or what happened to a request.", parameters: { type: 'object', properties: { hours: { type: 'integer', description: 'How far back, 1 to 168, default 24' } } } },
  { name: 'propose_request', description: 'Send a task to the Claude news desk (Mahir confirms with a button first). Use it when Mahir wants something only the news desk can do: cover a story, make a post on a topic, or change the content of a queued post (headline, a slide, the caption, the cover image). Claude handles it in its next run (within about 2 hours) and Mahir is told the result. Not for cancel, post now, reschedule or priority: use propose_action for those. For changes to an existing post call get_post first and pass its id.', parameters: { type: 'object', properties: {
    text: { type: 'string', description: 'The task for Claude in clear English, specific (which slide, what to change, what angle)' },
    original: { type: 'string', description: 'What Mahir asked, short, in Turkish, shown back to him' },
    job_id: { type: 'string', description: 'Exact job id when the request is about an existing post, else omit' },
    retry_of: { type: 'string', description: 'task_id of a failed request when Mahir asks to try it again (get_desk_log shows it), else omit' },
  }, required: ['text'] } },
  { name: 'calculate', description: 'Exact arithmetic. Use it for every percentage, ratio, difference or sum that is not already in the tool data. Never do math in your head.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Numbers and + - * / ( ) only, e.g. (12161-6387)/6387*100' } }, required: ['expression'] } },
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
  await env.KV.put('last_pending', `mdo:${key}`, { expirationTtl: 900 });
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
  if (name === 'get_links') return linkStatus(env);
  if (name === 'send_report') {
    const d = Math.min(90, Math.max(1, Number(args.days) || 7));
    await dispatch(env, 'report.yml', { days: String(d), send: 'true' });
    return `Report for the last ${d} days started; the PDF arrives in about 3 minutes.`;
  }
  if (name === 'get_instagram_stats') return postStats(env, args);
  if (name === 'get_threads_stats') { const d = Math.min(90, Math.max(1, Number(args.days) || 7)); return cached(env, `th${d}`, 1800, async () => JSON.stringify(await threadsStats(env, d))); }
  if (name === 'get_facebook_stats') { const d = Math.min(90, Math.max(1, Number(args.days) || 7)); return cached(env, `fb${d}`, 1800, async () => JSON.stringify(await facebookStats(env, d))); }
  if (name === 'get_all_platform_stats') { const d = Math.min(90, Math.max(1, Number(args.days) || 7)); return cached(env, `all${d}`, 1800, async () => JSON.stringify(await allPlatformStats(env, d))); }
  if (name === 'get_account_stats') { const d = Math.min(30, Math.max(1, Number(args.days) || 7)); return cached(env, `acct${d}`, 900, () => accountSummary(env, d)); }
  if (name === 'calculate') {
    const ex = String(args.expression || '').replace(/,/g, '');
    if (!/^[\d\s+\-*/().%]+$/.test(ex)) return 'Only numbers and + - * / ( ) are allowed.';
    try { const v = Function(`"use strict";return (${ex.replace(/%/g, '/100')})`)(); return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'not a number'; } catch { return 'invalid expression'; }
  }
  if (name === 'get_post') return postContent(env, String(args.id || ''));
  if (name === 'get_desk_log') return deskLog(env, Math.min(168, Math.max(1, Number(args.hours) || 24)));
  if (name === 'propose_request') {
    if (!String(args.text || '').trim()) return 'Write the task first.';
    const key = crypto.randomUUID().slice(0, 8);
    const r = { text: String(args.text).trim().slice(0, 1500), original: String(args.original || '').trim().slice(0, 500), job_id: args.job_id || null, retry_of: args.retry_of || null };
    await env.KV.put(`req:${key}`, JSON.stringify(r), { expirationTtl: 7 * 86400 });
    await env.KV.put('last_pending', `rdo:${key}`, { expirationTtl: 900 });
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `📝 Claude'a iletilsin mi?\n${r.original || r.text}${r.job_id ? `\nPost: ${r.job_id}` : ''}\n(Claude bir sonraki çalışmasında, en geç ~2 saatte yapar, sonucu buraya yazarım.)`, reply_markup: { inline_keyboard: [[{ text: '✅ Gönder', callback_data: `rdo:${key}` }, { text: '❌ Vazgeç', callback_data: `rundo:${key}` }]] } });
    return 'Confirmation buttons were sent to Mahir. Tell him briefly to confirm with the button.';
  }
  if (name === 'propose_memory') {
    await proposeMemory(env, { op: args.op || 'add', id: args.id, category: args.category, text: args.text, expires_at: args.expires_at, source: `telegram ${new Date().toISOString().slice(0, 10)}`, why: args.why });
    return 'A confirmation with buttons was sent to Mahir. Tell him in one short sentence to confirm with the button.';
  }
  if (name === 'propose_action') {
    const value = args.action === 'reschedule' ? postAtFrom(args.time || '') : args.action === 'priority' ? String(args.priority || 2) : '';
    if (args.action === 'reschedule' && !value) return 'Could not read the time. Ask Mahir for a clear time like 21:30.';
    const key = crypto.randomUUID().slice(0, 8);
    await env.KV.put(`act:${key}`, JSON.stringify({ action: args.action, id: args.id, value }), { expirationTtl: 3600 });
    await env.KV.put('last_pending', `do:${key}`, { expirationTtl: 900 });
    const NAMES = { cancel: 'İptal et', post_now: 'Şimdi paylaş', reschedule: 'Ertele', priority: 'Önceliği değiştir', approve: 'Onayla', reject: 'Reddet' };
    const extra = args.action === 'reschedule' ? `\nYeni saat: ${new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye)` : args.action === 'priority' ? `\nYeni öncelik: ${value}` : '';
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `${NAMES[args.action]}: ${args.id}${extra}\nOnaylıyor musun?`, reply_markup: { inline_keyboard: [[{ text: '✅ Evet', callback_data: `do:${key}` }, { text: '❌ Vazgeç', callback_data: `undo:${key}` }]] } });
    return 'Confirmation buttons were sent to Mahir. Tell him briefly to confirm with the button.';
  }
  return 'unknown tool';
}

async function chat(env, question) {
  // After 2 quiet hours a new conversation starts, so an old topic does not leak into a new
  // request (long-term memory stays).
  const quiet = Date.now() - Number((await env.KV.get('history_at')) || 0) > 2 * 3600e3;
  const history = quiet ? [] : JSON.parse((await env.KV.get('history')) || '[]');
  const memory = await loadMemory(env).catch(() => '[]');
  const ny = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const tr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const system = `Sen NeuraFeed Asistanısın: DeepSeek (${env.DEEPSEEK_MODEL || 'deepseek-v4-pro'}) modeliyle çalışan, @neurafeed.ai Instagram hesabının asistanısın. Claude değilsin; Claude ayrı bir agent olarak haber masasını yönetiyor (haber bulma, yazma, tasarım). Sana hangi model olduğun sorulursa bunu söyle. (İngilizce yapay zeka haberleri, Amerikan kitlesi). Sahibi Mahir ile Türkçe, kısa ve net konuşursun, "kanka" diyebilirsin. Markdown kullanma, düz metin ve kısa listeler yaz.
Sistem: Claude günün her saatinde 2 saatte bir (New York saatiyle tek saatlerin :52'sinde) çalışıp haber bulur, carousel ve Mahir'in linklerinden post hazırlar; normal postlar New York saatiyle 07:00-09:30, 11:00-13:30, 17:00-22:00 arasında, en az 60 dakika arayla, günde en fazla 8 tane çıkar. Mahir bota link atarsa post olur; o postlar onun onayıyla, limitten ayrı ve istediği saatte çıkar.
Şu an Türkiye: ${tr}, New York: ${ny}.
Mahir'in gönderdiği bir link, reel veya "paylaşıldı mı" sorusu için get_links kullan. Kuyruk ve Instagram verisi gerekiyorsa araçları kullan (get_queue, get_instagram_stats: hesabın TÜM postları, ilk günden beri, tarih ve format filtresiyle, get_account_stats: takipçi sayısı, günlük erişim, takipçi değişimi, kitle demografisi). Threads için get_threads_stats, Facebook için get_facebook_stats, haftalık/aylık veya üç platform birlikte sorulursa get_all_platform_stats (7 = haftalık, 30 = aylık) kullan. "Göremiyorum" deme, önce aracı çağır. Claude'un ne yaptığını, hangi haberi neden atladığını sorarsa get_desk_log, bir postun içeriğini (slaytlar, açıklama, kaynaklar, kapak) sorarsa get_post kullan. Claude'un yapması gereken bir iş isterse (bir haberi işle, şu konuda post yap, şu postun başlığını/slaytını/açıklamasını/kapağını değiştir) propose_request kullan. Bir posta işlem istenirse (iptal, şimdi paylaş, ertele, öncelik, onay) propose_action kullan, işlem butonla onaylanınca yapılır; "yaptım" deme, "onay butonuna bas" de. Sadece araçlardan gelen verilere dayan, sayı uydurma. Hesap gerekiyorsa (yüzde, oran, fark) kafadan yapma, calculate aracını kullan.
Mahir "onaylıyorum", "evet" gibi kısa onaylar yazarsa yeni bir öneri oluşturma; bunlar otomatik işlenir.
Kalıcı hafıza (Mahir'in kayıtlı tercihleri ve talimatları, bunlara uy; değiştirmek veya eklemek için propose_memory kullan, en fazla 50 madde, temel kurallar (haber uydurmamak, kopyalamamak, kaynak göstermek) hafızayla değişmez):
${memory}`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
  let answer = '';
  const STEPS = 8;
  for (let step = 0; step < STEPS; step++) {
    // The last round (and a retry after an empty answer) allows no tools, so the model must answer.
    const final = step === STEPS - 1 || messages.at(-1)?.content === FINAL_NUDGE;
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      // Room for the model's own thinking plus the answer; a tight limit left the answer empty.
      body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-v4-pro', temperature: 0.4, max_tokens: 4000, messages, tools: TOOLS, ...(final ? { tool_choice: 'none' } : {}) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // A busy or failing API: one quiet retry, then a clear message instead of a vague one.
      if (step < STEPS - 1 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw new Error(`DeepSeek: ${d.error?.message || res.status}`);
    }
    const msg = d.choices?.[0]?.message || {};
    if (msg.tool_calls?.length && !final) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const c of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* empty */ }
        const out = await runTool(env, c.function.name, args).catch((e) => `error: ${e.message}`);
        messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 12000) });
      }
      continue;
    }
    answer = (msg.content || '').trim();
    if (!answer && step < STEPS - 1 && messages.at(-1)?.content !== FINAL_NUDGE) {
      // Empty answer (it spent its budget thinking): ask once more, tools off, for a short reply.
      messages.push({ role: 'user', content: FINAL_NUDGE });
      continue;
    }
    break;
  }
  // Memory: last 25 messages (plain question and answer, without tool data).
  const next = [...history, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-HISTORY);
  await env.KV.put('history', JSON.stringify(next));
  await env.KV.put('history_at', String(Date.now()));
  return answer || 'Cevap üretemedim kanka, bir daha yazar mısın?';
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
    // Text files go inline; binary files ({ base64 }) are uploaded as blobs first.
    const entries = [];
    for (const [path, content] of Object.entries(next)) {
      if (content && typeof content === 'object' && content.base64) {
        const blob = await (await gh(env, 'git/blobs', { method: 'POST', body: JSON.stringify({ content: content.base64, encoding: 'base64' }) })).json();
        entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      } else entries.push({ path, mode: '100644', type: 'blob', content });
    }
    const tree = await (await gh(env, 'git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) })).json();
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

// The instant link task (a Claude scheduled task with an API trigger): started the moment Mahir
// sends a link or a request, so it does not wait for the 2-hourly desk. Returns true when started.
async function startLinkDesk(env, ids) {
  if (!env.LINK_ROUTINE_URL || !env.LINK_ROUTINE_TOKEN || env.LINK_ROUTINE_TOKEN === 'unset') return false;
  try {
    const res = await fetch(env.LINK_ROUTINE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LINK_ROUTINE_TOKEN}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Handle these inbox items now: ${ids.join(', ')}` }),
    });
    if (!res.ok) console.log(`link desk start failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) { console.log(`link desk start failed: ${e.message}`); return false; }
}

// Links and post actions go into small queue files; "Bot apply" processes whatever is pending.
async function queueLink(env, item, files = {}) {
  let added = false;
  await commitFiles(env, ['inbox/links.json'], (cur) => {
    const list = parseList(cur['inbox/links.json']);
    if (list.some((l) => l.id === item.id || (item.url && l.url === item.url))) return null;
    list.push(item);
    added = true;
    return { 'inbox/links.json': JSON.stringify(list, null, 2) + '\n', ...files };
  }, `inbox: link ${item.id}`);
  await dispatch(env, 'bot-apply.yml', {}).catch(() => {});
  return added;
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

async function repoFile(env, p) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${p}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'neurafeed-bot', Accept: 'application/vnd.github.raw' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} ${p}`);
  return r.text();
}
async function postContent(env, id) {
  if (!/^[\w-]+$/.test(id)) return 'Invalid id. Call get_queue for the exact id.';
  const raw = await repoFile(env, `jobs/${id}.json`);
  if (!raw) return `No post with id ${id}. Call get_queue for the exact id.`;
  const j = JSON.parse(raw);
  const st = JSON.parse((await repoFile(env, `state/jobs/${id}.json`).catch(() => null)) || 'null');
  const img = (i) => (!i ? null : i.generate ? { ai_generated: true, prompt: i.generate, fallback_photo: i.url || null } : { url: i.url, credit: i.credit || null });
  return JSON.stringify({
    id: j.id, status: st?.status || 'not rendered yet', status_by: st?.history?.at(-1)?.by || null, posted_at: st?.posted_at || null, type: j.type || 'carousel', format: j.format || 'news', priority: j.priority || 2, timely: j.timely, sensitive: j.sensitive,
    story_time: j.story_time, from_link: j.link_id || null, replaces: j.replaces || null, post_at: j.post_at || null, sources: j.sources,
    hook: j.hook, video: j.video?.url, caption: j.caption,
    slides: (j.slides || []).map((sl, i) => ({ n: i + 1, kind: sl.kind, headline: sl.headline, heading: sl.heading,
      paras: (sl.paras || []).map((x) => (typeof x === 'string' ? x : x.t)), hook: sl.hook, image: img(sl.image),
      badges: (sl.badges || []).length || undefined })),
  });
}
async function deskLog(env, hours) {
  const log = parseList(await repoFile(env, 'desk/log.json'));
  const since = Date.now() - hours * 3600e3;
  const runs = log.filter((r) => new Date(r.run_at).getTime() >= since);
  // Task status comes from state/requests.json (computed by the pipeline from facts, not claims).
  const status = JSON.parse((await repoFile(env, 'state/requests.json').catch(() => null)) || '{}');
  const requests = parseList(await repoFile(env, 'inbox/requests.json')).filter((q) => new Date(q.created_at).getTime() >= since || ['pending', 'running'].includes(status[q.id]?.status || 'pending'))
    .map((q) => ({ task_id: q.id, asked: q.original || q.text, about_post: q.job_id, at: q.created_at, status: status[q.id]?.status || 'pending', post: status[q.id]?.job_id || null, result: status[q.id]?.result || null }));
  const note = log.length ? undefined : 'The desk has not written a log yet (it starts with its next run).';
  const out = JSON.stringify({ requests, runs, note, statuses: 'pending = waiting for the next desk run (every 2 hours), running = post being made, completed, failed' });
  return out.length > 24000 ? JSON.stringify({ requests, runs: runs.slice(-6), note: 'Only the last 6 runs shown, ask for fewer hours for more detail.' }) : out;
}

// The news desk runs every 2 hours, at :52 past odd New York hours.
function nextDeskRun(now = new Date()) {
  for (let m = 1; m <= 24 * 60; m++) {
    const t = new Date(now.getTime() + m * 60000);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(t).map((x) => [x.type, x.value]));
    if (Number(p.minute) === 52 && Number(p.hour) % 2 === 1) return t;
  }
  return new Date(now.getTime() + 2 * 3600e3);
}
const trTime = (d) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

// gh() throws on any non-2xx answer; a missing file is normal here (no skips yet, no jobs dir).
async function repoJson(env, file, fallback) {
  try {
    const res = await gh(env, `contents/${file}`, { headers: { Accept: 'application/vnd.github.raw' } });
    return await res.json();
  } catch (e) {
    if (/\b404\b/.test(e.message)) return fallback;
    throw e;
  }
}

async function linkStatus(env) {
  const [links, skipped, summary, tree] = await Promise.all([
    repoJson(env, 'inbox/links.json', []), repoJson(env, 'inbox/skipped.json', []), repoJson(env, 'state/summary.json', { jobs: [] }),
    repoJson(env, 'jobs', []),
  ]);
  const next = trTime(nextDeskRun());
  const jobs = summary.jobs || [];
  const names = (Array.isArray(tree) ? tree : []).map((f) => f.name);
  const rows = links.slice(-10).reverse().map((l) => {
    const job = jobs.filter((j) => j.link_id === l.id).pop();
    const skip = skipped.find((s) => s.link_id === l.id);
    const base = { link_id: l.id, url: l.url || l.image_file || null, sent: l.received_at ? trTime(new Date(l.received_at)) : null, post_at: l.post_at ? trTime(new Date(l.post_at)) : null };
    if (job) return { ...base, state: 'job', job_id: job.id, status: job.status, posted_at: job.posted_at, headline: job.headline };
    if (skip) return { ...base, state: 'skipped', reason: skip.reason };
    const stem = String(l.id).replace(/^link-/, '');
    if (names.some((n) => n.includes(stem))) return { ...base, state: 'being_prepared', note: 'Job written, rendering now; preview comes in a few minutes.' };
    return { ...base, state: 'waiting_for_desk', next_desk_run: next };
  });
  return JSON.stringify({ now: trTime(new Date()), next_desk_run: next, links: rows });
}

async function queueSummary(env) {
  const res = await gh(env, 'contents/state/summary.json', { headers: { Accept: 'application/vnd.github.raw' } });
  return await res.text();
}

// ---------- Instagram ----------
// Every post with its numbers, in a few calls (insights come inside the media list). Cached 30 min.
async function allPosts(env) {
  return JSON.parse(await cached(env, 'allposts', 1800, async () => {
    const t = encodeURIComponent(env.IG_ACCESS_TOKEN);
    const fields = encodeURIComponent('id,caption,timestamp,media_type,media_product_type,permalink,like_count,comments_count,insights.metric(reach,views,saved,shares,total_interactions)');
    let url = `https://graph.instagram.com/${env.IG_USER_ID}/media?fields=${fields}&limit=100&access_token=${t}`;
    const rows = [];
    for (let i = 0; i < 12 && url; i++) {
      const d = await (await fetch(url)).json();
      if (d.error) throw new Error(d.error.message);
      for (const m of d.data || []) {
        const ins = {};
        for (const x of m.insights?.data || []) ins[x.name] = x.values?.[0]?.value ?? 0;
        rows.push({
          t: m.timestamp.slice(0, 16), f: m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : m.media_type === 'VIDEO' ? 'Video' : 'Single image',
          title: String(m.caption || '').split('\n')[0].slice(0, 90), url: m.permalink,
          likes: m.like_count || 0, comments: m.comments_count || 0, views: ins.views || 0, reach: ins.reach || 0, saved: ins.saved || 0, shares: ins.shares || 0, total_interactions: ins.total_interactions || 0,
        });
      }
      url = d.paging?.next || null;
    }
    return JSON.stringify(rows);
  }));
}
async function postStats(env, a = {}) {
  let rows = await allPosts(env);
  if (a.from) rows = rows.filter((r) => r.t >= a.from);
  if (a.to) rows = rows.filter((r) => r.t.slice(0, 10) <= a.to);
  if (a.format && a.format !== 'any') rows = rows.filter((r) => r.f === a.format);
  const by = a.sort_by || 'views';
  const n = Math.min(20, Math.max(1, Number(a.top) || 8));
  const keys = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'];
  const agg = (list) => { const o = { posts: list.length }; for (const k of keys) { const s = list.reduce((x, r) => x + r[k], 0); o[`total_${k}`] = s; o[`avg_${k}`] = list.length ? Math.round(s / list.length) : 0; } return o; };
  const group = (fn) => { const g = {}; for (const r of rows) (g[fn(r)] ||= []).push(r); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, agg(v)])); };
  // Ready-made comparisons so the model never has to do the math itself.
  const months = Object.entries(group((r) => r.t.slice(0, 7))).sort(([a], [b]) => a.localeCompare(b));
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const monthTrend = months.map(([m, v], i) => ({ month: m, posts: v.posts, avg_views: v.avg_views, avg_views_change_pct: i ? change(v.avg_views, months[i - 1][1].avg_views) : null, total_views: v.total_views, total_views_change_pct: i ? change(v.total_views, months[i - 1][1].total_views) : null }));
  const sorted = [...rows].sort((x, y) => y[by] - x[by]);
  return JSON.stringify({
    filter: { from: a.from || rows.at(-1)?.t?.slice(0, 10), to: a.to || rows[0]?.t?.slice(0, 10), format: a.format || 'any', sorted_by: by },
    overall: { ...agg(rows), interactions_per_1000_views: (() => { const v = rows.reduce((x, r) => x + r.views, 0); return v ? Math.round((rows.reduce((x, r) => x + r.total_interactions, 0) / v) * 10000) / 10 : null; })() },
    by_format: group((r) => r.f), month_trend: monthTrend,
    top: sorted.slice(0, n), bottom: sorted.slice(-n).reverse(),
  });
}

async function accountSummary(env, days) {
  const base = 'https://graph.instagram.com';
  const t = encodeURIComponent(env.IG_ACCESS_TOKEN);
  const get = async (u) => { const r = await (await fetch(`${base}/${u}${u.includes('?') ? '&' : '?'}access_token=${t}`)).json(); if (r.error) throw new Error(r.error.message); return r; };
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const until = Math.floor(Date.now() / 1000);
  const [acct, daily, ...demo] = await Promise.all([
    get(`${env.IG_USER_ID}?fields=username,followers_count,follows_count,media_count`),
    get(`${env.IG_USER_ID}/insights?metric=reach,follower_count&period=day&since=${since}&until=${until}`).catch((e) => ({ error: e.message })),
    ...['country', 'city', 'age', 'gender'].map((b) => get(`${env.IG_USER_ID}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${b}`).catch((e) => ({ error: e.message }))),
  ]);
  const tf = days <= 7 ? 'this_week' : 'this_month';
  const viewers = await Promise.all(['country', 'age'].map((b) => get(`${env.IG_USER_ID}/insights?metric=reached_audience_demographics&period=lifetime&timeframe=${tf}&metric_type=total_value&breakdown=${b}`).catch((e) => ({ error: e.message }))));
  const series = {};
  for (const m of daily.data || []) series[m.name] = (m.values || []).map((v) => ({ day: v.end_time?.slice(0, 10), value: v.value }));
  const top = (r) => {
    const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    return res.map((x) => ({ key: x.dimension_values?.join(' '), value: x.value })).sort((a, b) => b.value - a.value).slice(0, 8);
  };
  return JSON.stringify({
    username: acct.username, followers: acct.followers_count, following: acct.follows_count, posts: acct.media_count,
    daily_reach: series.reach || daily.error || [], daily_new_followers: series.follower_count || [],
    followers_by_country: top(demo[0]), followers_by_city: top(demo[1]), followers_by_age: top(demo[2]), followers_by_gender: top(demo[3]),
    viewers_timeframe: tf, viewers_by_country: top(viewers[0]), viewers_by_age: top(viewers[1]),
  });
}

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


// ---------- Threads and Facebook ----------
const sumVals = (m) => (m?.total_value?.value ?? (m?.values || []).reduce((x, v) => x + (Number(v.value) || 0), 0));
const lastVal = (m) => { const v = (m?.values || []).filter((x) => typeof x.value === 'number'); return v.length ? v.at(-1).value : (m?.total_value?.value ?? null); };
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const windowOf = (days, back = 0) => { const until = Math.floor(Date.now() / 1000) - back * days * 86400; return { since: until - days * 86400, until }; };

async function threadsGet(env, path) {
  if (!env.THREADS_TOKEN) throw new Error('THREADS_TOKEN eksik');
  const r = await (await fetch(`https://graph.threads.net/v1.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(env.THREADS_TOKEN)}`)).json();
  if (r.error) throw new Error(r.error.message);
  return r;
}
async function threadsTotals(env, w) {
  const r = await threadsGet(env, `me/threads_insights?metric=views,likes,replies,reposts,quotes,followers_count&since=${w.since}&until=${w.until}`);
  const o = {};
  for (const m of r.data || []) o[m.name] = m.name === 'followers_count' ? (m.total_value?.value ?? lastVal(m)) : sumVals(m);
  return o;
}
async function threadsStats(env, days = 7) {
  const [now, before, list] = await Promise.all([threadsTotals(env, windowOf(days)), threadsTotals(env, windowOf(days, 1)).catch(() => ({})), threadsGet(env, `me/threads?fields=id,text,timestamp,permalink,media_type&since=${windowOf(days).since}&limit=40`)]);
  const posts = await Promise.all((list.data || []).filter((p) => p.media_type !== 'REPOST_FACADE').slice(0, 40).map(async (p) => {
    const ins = await threadsGet(env, `${p.id}/insights?metric=views,likes,replies,reposts,quotes,shares`).catch(() => ({ data: [] }));
    const m = {}; for (const x of ins.data || []) m[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0;
    return { t: p.timestamp?.slice(0, 16), title: String(p.text || '').split('\n')[0].slice(0, 90), url: p.permalink, views: m.views || 0, likes: m.likes || 0, replies: m.replies || 0, reposts: m.reposts || 0, quotes: m.quotes || 0, shares: m.shares || 0 };
  }));
  const sorted = [...posts].sort((a, b) => b.views - a.views);
  return {
    platform: 'Threads', days, totals: now, previous_period: before,
    change_pct: Object.fromEntries(['views', 'likes', 'replies', 'reposts'].map((k) => [k, pct(now[k] || 0, before[k] || 0)])),
    posts: posts.length, avg_views_per_post: posts.length ? Math.round(posts.reduce((x, p) => x + p.views, 0) / posts.length) : 0,
    top: sorted.slice(0, 5), bottom: sorted.slice(-3).reverse(),
  };
}

async function fbPage(env) {
  if (!env.FB_PAGE_TOKEN) throw new Error('FB_PAGE_TOKEN eksik');
  return JSON.parse(await cached(env, 'fbpage', 3600, async () => {
    const r = await (await fetch(`https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(env.FB_PAGE_TOKEN)}`)).json();
    if (r.error || !r.data?.[0]) throw new Error(r.error?.message || 'Facebook sayfası bulunamadı');
    return JSON.stringify({ id: r.data[0].id, name: r.data[0].name, token: r.data[0].access_token });
  }));
}
async function fbGet(page, path) {
  const r = await (await fetch(`https://graph.facebook.com/v23.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(page.token)}`)).json();
  if (r.error) throw new Error(r.error.message);
  return r;
}
// Meta renamed the page metrics in 2025: views are page_media_view, reach page_total_media_view_unique.
async function fbTotals(page, w) {
  const r = await fbGet(page, `${page.id}/insights?metric=page_media_view,page_total_media_view_unique,page_post_engagements,page_daily_follows_unique,page_video_views,page_views_total&period=day&since=${w.since}&until=${w.until}`);
  const o = {}; for (const m of r.data || []) o[m.name] = sumVals(m);
  return { views: o.page_media_view || 0, reach_daily_sum: o.page_total_media_view_unique || 0, engagements: o.page_post_engagements || 0, new_follows: o.page_daily_follows_unique || 0, video_views: o.page_video_views || 0, page_visits: o.page_views_total || 0 };
}
async function facebookStats(env, days = 7) {
  const page = await fbPage(env);
  const [info, now, before, list] = await Promise.all([
    fbGet(page, `${page.id}?fields=name,followers_count`), fbTotals(page, windowOf(days)), fbTotals(page, windowOf(days, 1)).catch(() => ({})),
    fbGet(page, `${page.id}/posts?fields=id,created_time,message,permalink_url,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)&since=${windowOf(days).since}&limit=40`),
  ]);
  const posts = await Promise.all((list.data || []).slice(0, 40).map(async (p) => {
    const ins = await fbGet(page, `${p.id}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks`).catch(() => ({ data: [] }));
    const m = {}; for (const x of ins.data || []) m[x.name] = x.values?.[0]?.value ?? 0;
    return { t: p.created_time?.slice(0, 16), title: String(p.message || '').split('\n')[0].slice(0, 90), url: p.permalink_url, views: m.post_media_view || 0, reach: m.post_total_media_view_unique || 0, clicks: m.post_clicks || 0, reactions: p.reactions?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0 };
  }));
  const sorted = [...posts].sort((a, b) => b.views - a.views);
  return {
    platform: 'Facebook', page: info.name, followers: info.followers_count, days, totals: now, previous_period: before,
    change_pct: Object.fromEntries(['views', 'engagements', 'new_follows'].map((k) => [k, pct(now[k] || 0, before[k] || 0)])),
    posts: posts.length, avg_views_per_post: posts.length ? Math.round(posts.reduce((x, p) => x + p.views, 0) / posts.length) : 0,
    top: sorted.slice(0, 5), bottom: sorted.slice(-3).reverse(),
  };
}

// Instagram for the same window, from the post list (views of posts published in the window).
async function instagramWindow(env, days) {
  const rows = await allPosts(env);
  const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 16);
  const pick = (w) => rows.filter((r) => r.t >= iso(w.since) && r.t <= iso(w.until));
  const sum = (list, k) => list.reduce((x, r) => x + (r[k] || 0), 0);
  const now = pick(windowOf(days)); const before = pick(windowOf(days, 1));
  const tot = (l) => ({ posts: l.length, views: sum(l, 'views'), reach: sum(l, 'reach'), likes: sum(l, 'likes'), comments: sum(l, 'comments'), saved: sum(l, 'saved'), shares: sum(l, 'shares') });
  const acct = JSON.parse(await cached(env, `acct${Math.min(30, days)}`, 900, () => accountSummary(env, Math.min(30, days))));
  const newFollowers = (acct.daily_new_followers || []).reduce((x, d) => x + (Number(d.value) || 0), 0);
  const t = tot(now); const b = tot(before);
  return { platform: 'Instagram', formats: formatBreakdown(now), followers: acct.followers, new_followers: newFollowers, days, totals: t, previous_period: b, change_pct: { views: pct(t.views, b.views), likes: pct(t.likes, b.likes), posts: pct(t.posts, b.posts) }, top: [...now].sort((x, y) => y.views - x.views).slice(0, 5) };
}

// Per format: posts, average reach, engagement rate by reach and views, saves and shares.
function formatBreakdown(rows) {
  const by = {};
  for (const r of rows) (by[r.f] ||= []).push(r);
  return Object.entries(by).map(([format, l]) => {
    const t = (k) => l.reduce((x, r) => x + (r[k] || 0), 0);
    const reach = t('reach'); const views = t('views'); const inter = t('total_interactions') || (t('likes') + t('comments') + t('saved') + t('shares'));
    const pc = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    return { format, posts: l.length, avg_reach: Math.round(reach / l.length), avg_views: Math.round(views / l.length), er_reach_pct: pc(inter, reach), er_views_pct: pc(inter, views), saves_per_post: Math.round((t('saved') / l.length) * 10) / 10, shares_per_post: Math.round((t('shares') / l.length) * 10) / 10, save_share_rate_pct: pc(t('saved') + t('shares'), reach), small_sample: l.length < 5 };
  }).sort((a, b) => b.avg_reach - a.avg_reach);
}

// All three platforms side by side, with the change against the previous period of the same length.
async function allPlatformStats(env, days) {
  const [ig, th, fb] = await Promise.all([
    instagramWindow(env, days).catch((e) => ({ platform: 'Instagram', error: e.message })),
    threadsStats(env, days).catch((e) => ({ platform: 'Threads', error: e.message })),
    facebookStats(env, days).catch((e) => ({ platform: 'Facebook', error: e.message })),
  ]);
  const views = (x) => x.totals?.views || 0; const prev = (x) => x.previous_period?.views || 0;
  const total = views(ig) + views(th) + views(fb); const totalPrev = prev(ig) + prev(th) + prev(fb);
  return {
    period: days <= 7 ? 'son 7 gün' : `son ${days} gün`, days,
    combined: { views: total, previous_views: totalPrev, change_pct: pct(total, totalPrev), followers: (ig.followers || 0) + (th.totals?.followers_count || 0) + (fb.followers || 0), share_of_views: Object.fromEntries([['Instagram', views(ig)], ['Threads', views(th)], ['Facebook', views(fb)]].map(([k, v]) => [k, total ? Math.round((v / total) * 1000) / 10 : 0])) },
    instagram: ig, threads: th, facebook: fb,
    notes: 'Instagram views = views of posts published in the period. Threads and Facebook views = all views in the period (account level).',
  };
}

const fmtN = (n) => (n == null ? '?' : Number(n).toLocaleString('tr-TR'));
const fmtC = (c) => (c == null ? '' : ` (${c > 0 ? '+' : ''}${c}%)`);
function statsText(r) {
  const line = (x) => x.error ? `• ${x.platform}: veri alınamadı (${x.error.slice(0, 80)})`
    : `• ${x.platform}: ${fmtN(x.totals.views)} görüntülenme${fmtC(x.change_pct?.views)}, takipçi ${fmtN(x.followers ?? x.totals.followers_count)}${x.platform === 'Instagram' ? `, ${x.totals.posts} post, ${fmtN(x.totals.likes)} beğeni` : x.platform === 'Threads' ? `, ${fmtN(x.totals.likes)} beğeni, ${fmtN(x.totals.reposts)} repost` : `, ${fmtN(x.totals.engagements)} etkileşim, +${fmtN(x.totals.new_follows)} takip`}`;
  const best = [r.instagram, r.threads, r.facebook].filter((x) => x.top?.[0]).map((x) => `• ${x.platform}: ${x.top[0].title || 'post'} (${fmtN(x.top[0].views)})`);
  return [`📊 ${r.period}, 3 platform`, `Toplam: ${fmtN(r.combined.views)} görüntülenme${fmtC(r.combined.change_pct)}, ${fmtN(r.combined.followers)} takipçi`, `Pay: Instagram %${r.combined.share_of_views.Instagram}, Threads %${r.combined.share_of_views.Threads}, Facebook %${r.combined.share_of_views.Facebook}`, '', line(r.instagram), line(r.threads), line(r.facebook), '', 'Instagram formatlara göre:', ...(r.instagram.formats || []).map((f) => `• ${f.format} (${f.posts} post${f.small_sample ? ', örneklem küçük' : ''}): ort. erişim ${fmtN(f.avg_reach)}, ER erişim %${f.er_reach_pct ?? '?'} / görüntülenme %${f.er_views_pct ?? '?'}, kayıt ${f.saves_per_post}/post, paylaşım ${f.shares_per_post}/post`), '', 'En çok izlenen:', ...best].join('\n');
}

// ---------- Telegram ----------
// ---------- Website drafts (neurafeedai.com) ----------
// Every 5 minutes: AI drafts waiting for review on the site arrive here once, with a preview and
// buttons. "Approve & publish" checks the listed claims, adds the hero image, category and byline,
// approves and publishes; "Reject" rejects. The site does the work (admin API, bearer token).
async function siteApi(env, body) {
  const res = await fetch(`${env.SITE_ADMIN_ORIGIN}/api/jobs/telegram-review`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SITE_REVIEW_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `site ${res.status}`);
  return d;
}

function siteDraftText(d) {
  const lines = ['📰 Site için yeni makale taslağı', '', d.headline, ''];
  if (d.dek) lines.push(d.dek, '');
  if (d.excerpt) lines.push(`${d.excerpt}${d.words > 120 ? '…' : ''}`, '');
  lines.push(`Kategori: ${d.category || 'yok'} · ${d.words} kelime`);
  if (d.sources?.length) lines.push(`Kaynaklar: ${d.sources.map((s) => s.name).join(', ')}`);
  if (d.claimsToCheck?.length) lines.push('', 'Onaylarsan bu iddiaları kaynaklarla kontrol edilmiş sayarım:', ...d.claimsToCheck.map((c) => `• ${c}`));
  if (d.reviewUrl) lines.push('', `Tamamını oku / düzenle: ${d.reviewUrl}`);
  return lines.join('\n').slice(0, 3900);
}

async function siteDraftCheck(env) {
  if (!env.SITE_ADMIN_ORIGIN || !env.SITE_REVIEW_TOKEN || env.SITE_REVIEW_TOKEN === 'unset') return;
  const { drafts = [] } = await siteApi(env, { action: 'list' });
  let fresh = 0;
  for (const d of drafts) {
    if (await env.KV.get(`site:${d.id}`)) continue;
    // A draft that did not come from a desk story needs a cover made by the pipeline.
    if (!fresh++) await dispatch(env, 'site-heroes.yml', {}).catch(() => {});
    await tg(env, 'sendMessage', {
      chat_id: env.OWNER_CHAT_ID, text: siteDraftText(d), disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '✅ Onayla ve yayınla', callback_data: `sp:${d.id}` }, { text: '❌ Reddet', callback_data: `sr:${d.id}` }]] },
    });
    await env.KV.put(`site:${d.id}`, 'sent', { expirationTtl: 60 * 60 * 24 * 30 });
  }
}

// The site answers in English; Mahir reads Turkish.
function siteErrorTr(msg) {
  const m = String(msg || '');
  if (/cover image .* still being made/i.test(m)) return 'Bu taslağın kapak görseli hâlâ hazırlanıyor. 5-10 dakika sonra tekrar bas.';
  if (/no longer waiting for review/i.test(m)) return 'Bu taslak artık onay beklemiyor (yayınlanmış ya da reddedilmiş olabilir).';
  if (/review action failed/i.test(m)) return 'Sitede beklenmedik bir hata oldu. Birkaç dakika sonra tekrar dene; olmazsa bana söyle, kayıtlardan bakarım.';
  return m;
}

async function siteDraftButton(env, cb) {
  const [action, id] = String(cb.data).split(':');
  const owner = String(env.OWNER_CHAT_ID);
  const done = await env.KV.get(`site:${id}`);
  if (done === 'published' || done === 'rejected') return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: done === 'published' ? 'Zaten yayında' : 'Zaten reddedildi' });
  await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: action === 'sp' ? 'Yayınlıyorum…' : 'Reddediyorum…' });
  await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  try {
    if (action === 'sp') {
      const r = await siteApi(env, { action: 'approve_publish', articleId: id });
      await env.KV.put(`site:${id}`, 'published', { expirationTtl: 60 * 60 * 24 * 30 });
      return send(env, `✅ Yayında${r.category ? ` (${r.category})` : ''}.${r.url ? `\n${r.url}` : ''}`, cb.message.message_id);
    }
    await siteApi(env, { action: 'reject', articleId: id, note: 'Rejected from Telegram.' });
    await env.KV.put(`site:${id}`, 'rejected', { expirationTtl: 60 * 60 * 24 * 30 });
    return send(env, '❌ Taslak reddedildi, sitede yayınlanmayacak.', cb.message.message_id);
  } catch (e) {
    // Put the buttons back so Mahir can try again after fixing the problem.
    await tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: '✅ Onayla ve yayınla', callback_data: `sp:${id}` }, { text: '❌ Reddet', callback_data: `sr:${id}` }]] } }).catch(() => {});
    return send(env, `⚠️ Olmadı: ${siteErrorTr(e.message)}`, cb.message.message_id);
  }
}

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

// ---------- Replies: what is Mahir pointing at? ----------
// A reply to an earlier message (a preview, a report, an answer) carries that message as context,
// and the post it is about when the message names one or showed it.
const JOB_ID = /\b(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*[a-z0-9])\b/;
async function replyContext(env, m) {
  const r = m.reply_to_message;
  if (!r) return '';
  const t = [r.text, r.caption].filter(Boolean).join('\n');
  let job = (t.match(JOB_ID) || [])[1] || null;
  if (!job) {
    try {
      const sum = JSON.parse(await cached(env, 'queue', 300, () => queueSummary(env)));
      job = (sum.jobs || []).find((j) => (j.tg || []).includes(r.message_id))?.id || null;
    } catch { /* no summary */ }
  }
  const kind = r.photo ? ' (a picture of the post)' : r.video ? ' (a video)' : '';
  return `[Mahir is replying to an earlier message${job ? ` about the post ${job}` : ''}${kind}: "${t.slice(0, 1200) || '(no text)'}". Treat that message as what "this", "bunu", "bu post" means${job ? `; call get_post with id ${job} before answering or proposing a change` : ''}.]\n\n`;
}

// ---------- Step-by-step post wizard ----------
// post -> format -> link or picture -> headline -> caption (optional) -> time -> confirm.
// No AI in between: buttons and plain answers, so it always does exactly what was chosen.
const WZ_FORMATS = { carousel: '📰 Haber carousel', reel: '🎬 Reels', single: '🖼 Tekli görsel', prompt: '💡 Prompt carousel' };
const WZ_WORD = { carousel: 'carousel', reel: 'reel', single: 'tekli', prompt: 'prompt' };
const WZ_STEPS = ['format', 'link', 'title', 'caption', 'time', 'confirm'];
const CANCEL_ROW = [{ text: '❌ İptal', callback_data: 'wz:x' }];
const imageOf = (m) => (m.photo?.length ? { file_id: m.photo.at(-1).file_id, ext: 'jpg' }
  : m.document && /^image\//.test(m.document.mime_type || '') ? { file_id: m.document.file_id, ext: (m.document.mime_type.split('/')[1] || 'jpg').replace('jpeg', 'jpg') } : null);
async function wizGet(env) { const r = await env.KV.get('wiz'); return r ? JSON.parse(r) : null; }
const wizPut = (env, w) => env.KV.put('wiz', JSON.stringify(w), { expirationTtl: 3600 });
const nextStep = (step) => WZ_STEPS[WZ_STEPS.indexOf(step) + 1];
const whenText = (w) => (w.post_at === 'now' ? 'Hazır olunca hemen (onayından sonra)' : w.post_at ? `${new Date(w.post_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} (Türkiye saati)` : 'İlk uygun Amerika saati');

async function wizardStart(env, replyTo, preset = {}) {
  const w = { step: 'format', started: new Date().toISOString(), key: crypto.randomUUID().slice(0, 8), ...preset };
  await wizPut(env, w);
  if (preset.image) await send(env, '🖼 Görseli aldım, tekli post olarak hazırlıyorum.', replyTo);
  return wizardAsk(env, w);
}

async function wizardAsk(env, w) {
  const msg = (text, rows) => tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text, reply_markup: { inline_keyboard: [...rows, CANCEL_ROW] } });
  if (w.step === 'format') {
    return msg('📝 Yeni post. Hangi format?', [
      [{ text: WZ_FORMATS.carousel, callback_data: 'wz:f:carousel' }, { text: WZ_FORMATS.reel, callback_data: 'wz:f:reel' }],
      [{ text: WZ_FORMATS.single, callback_data: 'wz:f:single' }, { text: WZ_FORMATS.prompt, callback_data: 'wz:f:prompt' }],
    ]);
  }
  if (w.step === 'link') {
    const ask = {
      carousel: 'Haberin linkini gönder.',
      reel: 'Videonun linkini gönder (X, Instagram, TikTok, YouTube).\nYouTube ise istersen saati de yaz: 12:30-13:10',
      single: 'Linki gönder ya da görseli buraya at.\nEn iyi kalite için görseli "Dosya" olarak gönder.',
      prompt: 'Prompt, araç ya da paylaşımın linkini gönder.',
    }[w.format];
    return msg(ask, []);
  }
  if (w.step === 'title') {
    const ask = w.format === 'reel' ? 'Videonun üstünde ne yazsın? Başlığı yaz.\nTürkçe yazarsan İngilizceye çevrilir.' : 'Başlığı yazmak ister misin?\nTürkçe yazarsan İngilizceye çevrilir.';
    return msg(ask, [[{ text: '✍️ Claude yazsın', callback_data: 'wz:s' }]]);
  }
  if (w.step === 'caption') return msg('Açıklamayı (caption) yazmak ister misin?\nKaynak ve takip satırları otomatik eklenir.', [[{ text: '✍️ Claude yazsın', callback_data: 'wz:s' }]]);
  if (w.step === 'time') {
    return msg('Ne zaman paylaşılsın?\nSaat yazabilirsin: 21:30, yarın 10:00, NY 18:00', [
      [{ text: '🇺🇸 İlk uygun Amerika saati', callback_data: 'wz:t:auto' }],
      [{ text: '⚡ Hazır olunca hemen', callback_data: 'wz:t:now' }],
    ]);
  }
  const lines = [
    '📋 Özet', `Format: ${WZ_FORMATS[w.format]}`,
    w.url ? `Link: ${w.url}` : w.image ? 'Görsel: gönderdiğin görsel' : '',
    w.extra ? `Not: ${w.extra}` : '',
    `Başlık: ${w.title || 'Claude yazacak'}`, `Açıklama: ${w.caption || 'Claude yazacak'}`, `Zaman: ${whenText(w)}`,
    '', 'Claude hazırlayınca önizlemesi buraya gelecek, sen onaylamadan paylaşılmaz.',
  ].filter((l) => l !== '');
  return tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: lines.join('\n'), reply_markup: { inline_keyboard: [[{ text: '✅ Onayla', callback_data: 'wz:ok' }], [{ text: '✏️ Baştan', callback_data: 'wz:r' }, ...CANCEL_ROW]] } });
}

async function wizardInput(env, w, m, text) {
  const t = text.trim();
  if (/^\/?(iptal|vazgeç|vazgec|cancel)$/i.test(t)) { await env.KV.delete('wiz'); return send(env, '❌ Post hazırlamayı iptal ettim.', m.message_id); }
  if (w.step === 'format') return send(env, 'Önce yukarıdaki butonlardan formatı seç.', m.message_id);
  if (w.step === 'link') {
    const extra = [...(m.entities || []), ...(m.caption_entities || [])].filter((e) => e.type === 'text_link').map((e) => e.url);
    const url = [...(t.match(URL_RE) || []), ...extra][0];
    const img = imageOf(m);
    if (url) { w.url = url.replace(/[).,]+$/, ''); w.extra = t.replace(URL_RE, '').trim(); delete w.image; }
    else if (img && ['single', 'carousel'].includes(w.format)) { w.image = img; w.extra = t; }
    else return send(env, w.format === 'single' ? 'Link ya da görsel bulamadım. Linki yapıştır ya da görseli gönder.' : 'Link bulamadım. Linki yapıştırıp gönder.', m.message_id);
  } else if (w.step === 'title') {
    if (!t) return send(env, 'Başlığı yazı olarak gönder ya da "Claude yazsın" butonuna bas.', m.message_id);
    w.title = t.slice(0, 300);
  } else if (w.step === 'caption') {
    if (!t) return send(env, 'Açıklamayı yazı olarak gönder ya da "Claude yazsın" butonuna bas.', m.message_id);
    w.caption = t.slice(0, 2000);
  } else if (w.step === 'time') {
    const at = postAtFrom(t, new Date(m.date * 1000));
    if (!at) return send(env, 'Saati anlayamadım. Örnek: 21:30, yarın 10:00, NY 18:00. Ya da butonlardan seç.', m.message_id);
    w.post_at = at;
  } else if (w.step === 'confirm') {
    return send(env, 'Özetteki "Onayla" butonuna bas ya da "iptal" yaz.', m.message_id);
  }
  w.step = nextStep(w.step);
  await wizPut(env, w);
  return wizardAsk(env, w);
}

async function wizardButton(env, cb) {
  const owner = String(env.OWNER_CHAT_ID);
  const [, cmd, val] = String(cb.data).split(':');
  const done = (text) => Promise.all([
    tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {}),
    tg(env, 'editMessageReplyMarkup', { chat_id: owner, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {}),
  ]);
  const w = await wizGet(env);
  if (cmd === 'x') { await env.KV.delete('wiz'); await done('İptal'); return send(env, '❌ Post hazırlamayı iptal ettim.'); }
  if (cmd === 'r') { await done('Baştan'); return wizardStart(env); }
  if (!w) { await done('Süresi doldu'); return send(env, 'Bu post taslağının süresi doldu. "post" yazıp yeniden başlayabilirsin.'); }
  const expect = { f: 'format', s: ['title', 'caption'], t: 'time', ok: 'confirm' }[cmd];
  if (expect && ![].concat(expect).includes(w.step)) { await done('Bu adım geçti'); return; }
  if (cmd === 'f' && WZ_FORMATS[val]) { w.format = val; w.step = 'link'; }
  else if (cmd === 's') { w.step = nextStep(w.step); }
  else if (cmd === 't') { w.post_at = val === 'now' ? 'now' : null; w.step = 'confirm'; }
  else if (cmd === 'ok') { await done('Gönderiliyor'); return wizardSubmit(env, w); }
  else { await done(''); return; }
  await done('Tamam');
  await wizPut(env, w);
  return wizardAsk(env, w);
}

// Saves the post as an inbox link (with the picture in the repo when one was sent).
async function wizardSubmit(env, w) {
  const now = new Date();
  const id = `link-${now.toISOString().slice(0, 10)}-w${w.key}`;
  const files = {};
  let imageFile = null;
  if (w.image) {
    const f = await tg(env, 'getFile', { file_id: w.image.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
    if (!res.ok) throw new Error(`görsel indirilemedi (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    imageFile = `inbox/uploads/${id}.${w.image.ext || 'jpg'}`;
    files[imageFile] = { base64: btoa(bin) };
  }
  const note = [WZ_WORD[w.format], w.extra || '', w.title ? `başlık: ${w.title}` : '', w.caption ? `caption: ${w.caption}` : ''].filter(Boolean).join('\n');
  const item = {
    id, url: w.url || null, image_file: imageFile, note, format: w.format,
    title: w.title || null, caption: w.caption || null,
    post_at: w.post_at === 'now' ? now.toISOString() : (w.post_at || null),
    ...(w.post_at ? {} : { us_window: true }),
    received_at: now.toISOString(), from: 'wizard',
  };
  const added = await queueLink(env, item, files);
  await env.KV.delete('wiz');
  if (!added) return send(env, 'ℹ️ Bu link zaten sırada, ikinci kez eklemedim.');
  const started = await startLinkDesk(env, [id]);
  return send(env, `✅ Sıraya aldım (${WZ_FORMATS[w.format]}, ${whenText(w)}).\n${started ? 'Claude şimdi hazırlıyor, 5-10 dakikada önizlemesi gelir.' : `Claude ${trTime(nextDeskRun())} çalışmasında hazırlayacak, önizlemesini buraya atacağım.`} Sen onaylamadan paylaşılmaz.`);
}

// For tests only.
export const _test = { statsText, allPlatformStats, startLinkDesk, nextDeskRun, linkStatus, siteDraftCheck, siteDraftButton, siteDraftText };
