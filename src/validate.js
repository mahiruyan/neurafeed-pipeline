// Checks a job file before rendering. Returns a list of problems (empty = OK).
const KINDS = new Set(['cover', 'text', 'cta', 'card', 'product', 'post', 'prompt', 'summary']);
const NEEDS_IMAGE = new Set(['cover', 'text', 'card', 'product']);
const CARD_MAX_CHARS = 260;
const SITE_CATEGORIES = new Set(['breaking', 'companies', 'models', 'robotics', 'free-tools', 'policy']);
const DASHES = /[–—]/; // NeuraFeed rule: no en dash or em dash anywhere.

function textOf(job) {
  const parts = [job.caption || ''];
  for (const s of job.slides || []) {
    // A post card's text is a quote, kept word for word (the template replaces dashes in it).
    parts.push(s.headline || '', s.heading || '', s.hook || '', s.note || '', s.prompt || '');
    for (const p of [...(s.paras || []), ...(s.points || [])]) parts.push(typeof p === 'object' ? p.t : p);
  }
  return parts.join('\n');
}

function validateReel(job, fileId) {
  const p = [];
  if (job.id !== fileId) p.push(`id "${job.id}" must match the file name "${fileId}"`);
  if (!job.video || !job.video.url) p.push('video.url is required');
  if (!job.hook) p.push('hook is required');
  if (!job.caption) p.push('caption is required');
  if (job.site_category !== undefined && !SITE_CATEGORIES.has(job.site_category)) p.push(`site_category must be one of: ${[...SITE_CATEGORIES].join(', ')}`);
  if (!Array.isArray(job.sources) || job.sources.length < 1) p.push('at least one source is required');
  if (typeof job.sensitive !== 'boolean') p.push('sensitive must be true or false');
  if (DASHES.test([job.hook, job.caption, job.credit].join('\n'))) p.push('text contains an en dash or em dash');
  if (!/(Source|Credit|Video):/i.test(job.caption || '')) p.push('caption must end with "Source:" or "Video:" and the original creator');
  return p;
}

// The website article the desk writes for a news story (job.site_article). Problems here do not
// block the Instagram post: the desk fixes them, and the desk feed leaves out an article that
// still has problems (the site then has no draft for that story).
const ARTICLE_KINDS = new Set(['fact', 'analysis', 'heading', 'why_it_matters']);
// Guides (utility posts) also have numbered steps, prompts to copy and tips.
const GUIDE_KINDS = new Set([...ARTICLE_KINDS, 'step', 'prompt', 'tip']);
const BANNED_PHRASES = ['game-changing', 'groundbreaking', 'revolutionary', 'rapidly evolving landscape', 'marks a significant milestone', 'it remains to be seen', 'delve into', 'a testament to', 'only time will tell'];
function validateSiteArticle(job) {
  const a = job.site_article;
  if (a === undefined) return [];
  const p = [];
  const str = (v) => typeof v === 'string' && v.trim();
  if (!a || typeof a !== 'object') return ['site_article must be an object'];
  for (const k of ['headline', 'dek', 'summary', 'seo_title', 'seo_description', 'answer_summary']) if (!str(a[k])) p.push(`site_article.${k} is required`);
  if (str(a.seo_description) && a.seo_description.length > 160) p.push(`site_article.seo_description is ${a.seo_description.length} characters (max 160)`);
  if (str(a.headline) && a.headline.length > 110) p.push('site_article.headline is longer than 110 characters');
  const guide = a.kind === 'guide';
  const kinds = guide ? GUIDE_KINDS : ARTICLE_KINDS;
  const paras = Array.isArray(a.paragraphs) ? a.paragraphs : [];
  if (paras.length < 5) p.push('site_article.paragraphs needs at least 5 items');
  const nSources = (job.sources || []).length;
  paras.forEach((x, i) => {
    if (!x || !kinds.has(x.kind) || !str(x.text)) { p.push(`site_article paragraph ${i + 1}: kind (${[...kinds].join(', ')}) and text are required`); return; }
    if (x.kind === 'step' && !str(x.title)) p.push(`site_article paragraph ${i + 1}: a step needs a short title ("1. Open Canvas")`);
    const src = Array.isArray(x.sources) ? x.sources : [];
    if (x.kind === 'fact' && (!src.length || !src.every((n) => Number.isInteger(n) && n >= 0 && n < nSources))) p.push(`site_article paragraph ${i + 1}: a fact paragraph needs sources as indexes into job.sources (0 to ${nSources - 1})`);
    if (x.kind !== 'fact' && src.length) p.push(`site_article paragraph ${i + 1}: only fact paragraphs cite sources`);
  });
  if (paras.length && paras[0]?.kind !== 'fact') p.push('site_article: the first paragraph must be a fact paragraph (what happened)');
  if (!guide && paras.length && paras.at(-1)?.kind !== 'why_it_matters') p.push('site_article: the last paragraph must be why_it_matters (a concrete thing to watch next)');
  if (guide && !paras.some((x) => x?.kind === 'step' || x?.kind === 'prompt')) p.push('site_article (guide): needs step or prompt paragraphs');
  const body = paras.map((x) => [x?.title, x?.text].filter(Boolean).join(' ')).join(' ');
  const words = body.split(/\s+/).filter(Boolean).length;
  const [minWords, maxWords] = guide ? [700, 1600] : [450, 850];
  if (words < minWords || words > maxWords) p.push(`site_article body is ${words} words (write ${minWords} to ${maxWords})`);
  // Prompt text is the reader's to copy: it may ask questions and use any wording.
  const prose = paras.filter((x) => x?.kind !== 'prompt').map((x) => [x?.title, x?.text].filter(Boolean).join(' ')).join(' ');
  const all = [a.headline, a.dek, a.summary, a.seo_title, a.seo_description, a.answer_summary, a.hero_alt, prose].join('\n');
  if (DASHES.test(all)) p.push('site_article contains an en dash or em dash');
  const lower = all.toLowerCase();
  for (const b of BANNED_PHRASES) if (lower.includes(b)) p.push(`site_article uses the phrase "${b}"`);
  if (/\?/.test(all)) p.push('site_article: no questions (rhetorical questions are not allowed)');
  return p;
}

function validateJob(job, fileId) {
  if (job.type === 'reel') return validateReel(job, fileId);
  const p = [];
  if (job.id !== fileId) p.push(`id "${job.id}" must match the file name "${fileId}"`);
  const single = job.format === 'single';
  if (!Array.isArray(job.slides) || (single ? job.slides.length !== 1 : (job.slides.length < 3 || job.slides.length > 8))) p.push(single ? 'a single post has exactly 1 slide (a cover)' : 'slides must be an array of 3 to 8 items');
  if (!job.caption) p.push('caption is required');
  // A single post made from a picture Mahir sent (inbox/uploads/...) is his own content: no outside source needed.
  const ownPicture = single && /^inbox\/uploads\//.test(job.slides?.[0]?.image?.url || '');
  if (!ownPicture && (!Array.isArray(job.sources) || job.sources.length < 1)) p.push('at least one source is required');
  if (typeof job.timely !== 'boolean') p.push('timely must be true or false');
  if (typeof job.sensitive !== 'boolean') p.push('sensitive must be true or false');
  (job.slides || []).forEach((s, i) => {
    if (!KINDS.has(s.kind)) p.push(`slide ${i + 1}: unknown kind "${s.kind}"`);
    if (NEEDS_IMAGE.has(s.kind) && (!s.image || !(s.image.url || s.image.generate))) p.push(`slide ${i + 1}: image.url (or image.generate) is required`);
    if (['card', 'product', 'prompt'].includes(s.kind) && !s.heading) p.push(`slide ${i + 1}: heading is required`);
    // Long text is split across slides, never shrunk: Mahir wants big, readable inner slides.
    if (s.kind === 'card') {
      const len = (s.paras || []).map((x) => (typeof x === 'object' ? x.t : x) || '').join(' ').length + (s.note || '').length;
      if (len > CARD_MAX_CHARS) p.push(`slide ${i + 1}: card text is ${len} characters (max ${CARD_MAX_CHARS}); split it into two card slides`);
    }
    if (s.kind === 'post' && !(s.author?.name && s.text)) p.push(`slide ${i + 1}: a post needs author.name and the post's exact text`);
    if (s.kind === 'prompt' && !s.prompt) p.push(`slide ${i + 1}: prompt is required`);
    if (s.kind === 'summary' && !((s.points || s.paras || []).length >= 2)) p.push(`slide ${i + 1}: a summary needs 2 to 6 points`);
  });
  if (job.slides?.[0]?.kind !== 'cover') p.push('first slide must be a cover');
  if (!single && job.slides?.at(-1)?.kind !== 'cta') p.push('last slide must be a cta');
  const urls = (job.slides || []).map((s) => s.image?.url).filter(Boolean);
  const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
  if (dupes.length) p.push('the same image is used on more than one slide');
  if (DASHES.test(textOf(job))) p.push('text contains an en dash or em dash');
  if (job.threads_text !== undefined) {
    const t = String(job.threads_text || '');
    if (!t.trim() || t.length > 420) p.push('threads_text must be 1 to 420 characters');
    if (DASHES.test(t)) p.push('threads_text contains an en dash or em dash');
    if (/#\w/.test(t)) p.push('threads_text: no hashtags');
  }
  if (!ownPicture && !/Source:/i.test(job.caption || '')) p.push('caption must end with "Source:" and the outlet name');
  return p;
}

module.exports = { validateSiteArticle, validateJob };
