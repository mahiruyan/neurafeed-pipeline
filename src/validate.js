// Checks a job file before rendering. Returns a list of problems (empty = OK).
const KINDS = new Set(['cover', 'text', 'cta', 'card', 'product', 'post', 'prompt', 'summary']);
const NEEDS_IMAGE = new Set(['cover', 'text', 'card', 'product']);
const CARD_MAX_CHARS = 260;
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
  if (!Array.isArray(job.sources) || job.sources.length < 1) p.push('at least one source is required');
  if (typeof job.sensitive !== 'boolean') p.push('sensitive must be true or false');
  if (DASHES.test([job.hook, job.caption, job.credit].join('\n'))) p.push('text contains an en dash or em dash');
  if (!/(Source|Credit|Video):/i.test(job.caption || '')) p.push('caption must end with "Source:" or "Video:" and the original creator');
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
  if (!ownPicture && !/Source:/i.test(job.caption || '')) p.push('caption must end with "Source:" and the outlet name');
  return p;
}

module.exports = { validateJob };
