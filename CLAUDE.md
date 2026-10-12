# NeuraFeed pipeline

This repo turns AI news into Instagram carousels for @neurafeed.ai.

Flow (config `"mode": "auto"`): a scheduled Claude task writes `jobs/<id>.json` and pushes
to `main` → the `process.yml` Action downloads images, renders 1080x1350 JPEGs into
`out/<id>/` and auto-approves the job unless it is sensitive or (for news) has fewer than
2 sources → it publishes right away if inside a posting window, otherwise `poll.yml`
(every 5 min) does it later. Posts only go out inside US prime-time windows (New York time:
07:00-09:30, 11:00-13:30, 17:00-22:00), at least 60 minutes apart, at most 8 per day,
highest `priority` first. Telegram is optional (notifications,
or Approve / Reject buttons when `mode` is not `auto`).

Because auto mode has no human check, a timely news job MUST list at least 2 independent
sources you actually read, or it will be skipped.

## Volume

The account needs 4 to 8 posts per day. Every major story (priority 1) must be covered the
same day. Never skip a priority 1 story because other stories are already queued.

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
- `timely`: true for breaking news. Timely jobs expire 12 hours after `story_time`.
- `priority`: 1 = must post (major news from OpenAI, Anthropic, Google, Meta, Microsoft, Apple,
  NVIDIA, xAI or a story everyone in AI is talking about), 2 = normal (default), 3 = filler.
- `sensitive`: true for deaths, lawsuits, crime, politics, layoffs, health. Never auto-posted.
- 3 to 8 slides. First `cover`, last `cta`. Every slide needs `image.url`.
- `pos` (optional): CSS object-position. Use it so faces are not cut off.
- Optional per slide: `size` (paragraph px, default 34), `hsize` (heading px), `gap`.
- Optional per slide: `badges`, up to 2 round overlays on the photo, for the company logo or a
  second person in the story: `[{ "url": "...", "fit": "contain" }]` (logo, white circle) or
  `{ "url": "...", "fit": "cover", "pos": "center 20%" }` (a face). `badge_side`: `"right"`
  (default) or `"left"`, pick the side that does not cover a face or text in the photo.
  Use badges on the cover whenever a company or a second person is central to the story.
  Logos can come from any reliable source: the company's own press kit or brand page, its
  website or app icon, Wikipedia or Wikimedia Commons (`File:<Company> logo.svg`, take the
  API `thumburl` PNG exactly as returned). Prefer the square symbol over a wide wordmark.
  `badge_border`: `"green"` (default), `"black"` or `"white"`, pick what reads best on that photo.

## Leads

`leads/latest.json` is refreshed every hour by the `scan.yml` Action: hot Reddit posts from
AI subreddits (with score, comment count and image URLs) and the latest items from AI news
RSS feeds. Read it first in every run. Reddit shows what people care about; confirm the facts
with real sources before writing.

## Images

Order of preference: images inside the source article, images from the Reddit post about the
story (`i.redd.it` / `preview.redd.it` URLs in leads, credit `via r/<subreddit>`), official
company press images,
then Wikimedia Commons photos of the people or products named in the story
(use the Commons API: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<query>&prop=imageinfo&iiprop=url|size&iiurlwidth=1920`
and copy `thumburl` exactly as returned). Never edit the size in a Wikimedia thumbnail URL:
non-standard widths (for example 1600px) are rejected with HTTP 400. Minimum 1000 px wide. Add 1 or 2 `fallback_urls` per slide.
