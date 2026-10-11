# NeuraFeed pipeline

This repo turns AI news into Instagram carousels for @neurafeed.ai.

Flow: a scheduled Claude task writes `jobs/<id>.json` and pushes to `main` → the
`process.yml` Action downloads images, renders 1080x1350 PNGs into `out/<id>/` and sends
them to Telegram with Approve / Reject buttons → `poll.yml` (every 5 min) reads the
buttons, applies the night rule, expires stale news, enforces the daily cap and publishes.

## Rules that must never be broken

- Never write a job that copies another account's post. Use the original source.
- Never invent facts, numbers, quotes or dates. Every claim must be in a source you read.
- Never use an en dash or em dash anywhere (slides or caption). Validation rejects them.
- Never reuse the same image on two slides of one carousel.
- Do not edit `state/` or `out/` by hand. Actions own them.
- Do not change `config.json`, workflows or `src/` from a scheduled run.

## Editorial voice

- American English spelling (color, analyze, percent), news-wire tone.
- Lead with what happened. Short sentences. No hype words ("insane", "mind-blowing",
  "game-changer", "revolutionary"), no "Let's dive in", no addressing the reader as "you guys".
- Headlines: specific, under 14 words, one *highlighted* phrase (asterisks) for the key detail.
- Inner slides: a topic heading for that slide (never "What happened" / "Why it matters"),
  then 2 short paragraphs, each under 40 words. Split into more slides instead of shrinking text.
- CTA hook: one sentence tied to this specific story, giving a reason to follow.
- Caption: 2 to 4 short lines summarizing the story, one question to drive comments,
  "Follow @neurafeed.ai for daily AI news.", then a final line `Source: <Outlet>` (add
  `· Photo: <credit>` when the photo needs credit).

## Job file format (`jobs/<id>.json`)

```json
{
  "id": "2026-10-12-nadella-emergency-brake",
  "created_at": "2026-10-12T14:05:00Z",
  "story_time": "2026-10-10T21:47:00Z",
  "timely": true,
  "sensitive": false,
  "sources": [
    { "name": "TechCrunch", "url": "https://techcrunch.com/..." },
    { "name": "Nadella on X", "url": "https://x.com/satyanadella/status/..." }
  ],
  "caption": "...\n\nSource: TechCrunch · Photo: Dan DeLong",
  "slides": [
    { "kind": "cover", "headline": "Microsoft CEO Satya Nadella says AI needs an *emergency brake*",
      "image": { "url": "https://...", "credit": "Dan DeLong", "fallback_urls": [] }, "pos": "22% center" },
    { "kind": "text", "heading": "No more *black boxes*", "paras": ["...", "..."],
      "image": { "url": "https://upload.wikimedia.org/...", "credit": "Brian Smale / CC BY-SA 4.0" } },
    { "kind": "text", "heading": "...", "paras": ["...", { "t": "Bold green takeaway.", "strong": true }],
      "image": { "url": "..." } },
    { "kind": "cta", "hook": "One sentence tied to this story.", "image": { "url": "..." } }
  ]
}
```

- `id`: `YYYY-MM-DD-short-slug`, must equal the file name.
- `timely`: true for breaking news. Timely jobs expire 4 hours after `story_time`.
- `sensitive`: true for deaths, lawsuits, crime, politics, layoffs, health. Never auto-posted.
- 3 to 8 slides. First `cover`, last `cta`. Every slide needs `image.url`.
- `pos` (optional): CSS object-position. Use it so faces are not cut off.
- Optional per slide: `size` (paragraph px, default 34), `hsize` (heading px), `gap`.

## Images

Order of preference: images inside the source article, official company press images,
then Wikimedia Commons photos of the people or products named in the story
(use the Commons API: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<query>&prop=imageinfo&iiprop=url|size&iiurlwidth=1600`
and take `thumburl`). Minimum 1000 px wide. Add 1 or 2 `fallback_urls` per slide.
