// Checks a job file before rendering. Returns a list of problems (empty = OK).
const KINDS = new Set(['cover', 'text', 'cta']);
const DASHES = /[–—]/; // NeuraFeed rule: no en dash or em dash anywhere.

function textOf(job) {
  const parts = [job.caption || ''];
  for (const s of job.slides || []) {
    parts.push(s.headline || '', s.heading || '', s.hook || '');
    for (const p of s.paras || []) parts.push(typeof p === 'object' ? p.t : p);
  }
  return parts.join('\n');
}

function validateJob(job, fileId) {
  const p = [];
  if (job.id !== fileId) p.push(`id "${job.id}" must match the file name "${fileId}"`);
  if (!Array.isArray(job.slides) || job.slides.length < 3 || job.slides.length > 8) p.push('slides must be an array of 3 to 8 items');
  if (!job.caption) p.push('caption is required');
  if (!Array.isArray(job.sources) || job.sources.length < 1) p.push('at least one source is required');
  if (typeof job.timely !== 'boolean') p.push('timely must be true or false');
  if (typeof job.sensitive !== 'boolean') p.push('sensitive must be true or false');
  (job.slides || []).forEach((s, i) => {
    if (!KINDS.has(s.kind)) p.push(`slide ${i + 1}: unknown kind "${s.kind}"`);
    if (!s.image || !s.image.url) p.push(`slide ${i + 1}: image.url is required`);
  });
  if (job.slides?.[0]?.kind !== 'cover') p.push('first slide must be a cover');
  if (job.slides?.at(-1)?.kind !== 'cta') p.push('last slide must be a cta');
  const urls = (job.slides || []).map((s) => s.image?.url).filter(Boolean);
  const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
  if (dupes.length) p.push('the same image is used on more than one slide');
  if (DASHES.test(textOf(job))) p.push('text contains an en dash or em dash');
  if (!/Source:/i.test(job.caption || '')) p.push('caption must end with "Source:" and the outlet name');
  return p;
}

module.exports = { validateJob };
