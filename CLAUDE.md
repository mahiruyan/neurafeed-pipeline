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
- Slides and captions: lead with what happened, short sentences, no "Let's dive in".
- Headlines are written to stop the scroll, like the biggest AI accounts: bold, provocative,
  curiosity-driven, emotional ("Claude confidently lies to you every single day. This one prompt
  forces it to tell the truth", "People using ChatGPT without these symbols are missing out on 90%
  of what it can do", "Someone just canceled Elon Musk's order after he leaked it online").
  Hype words are fine. The facts inside the headline must still be true to the sources: frame and
  dramatize, never invent a number, quote or event.
- Headlines: under 18 words, one *highlighted* phrase (asterisks) for the key detail.
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
- `sensitive`: true for deaths, lawsuits, crime, politics, layoffs, health. Never auto-posted: it is sent to Mahir on Telegram with Approve / Reject buttons. Still write it, especially when it is priority 1.
- `owner_approved`: only set to true when Mahir himself asked for that story to be posted.
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
- Mascots and product characters: when the story is about a product that has an official mascot,
  character or icon (for example Meta's Muse mascot), put it on the cover. Take it from the
  company's own newsroom, press kit, blog post or app store page. Use a round badge
  (`"fit": "contain"`), or, when the file is a transparent PNG, `{ "url": "...", "shape": "free" }`
  so it stands on the photo with no circle. On the cover, free items are placed like a magazine
  collage: `"side": "left"` or `"right"`, optional `"top"` (px, default 300) and `"scale"`
  (default 1). Typical cover: the person in the middle (`pos`), the company's transparent logo
  free on one side, the mascot or product free on the other, never covering a face.
  If the mascot or product image has a background, add `"cutout": true` to that badge: the
  pipeline removes the background automatically and shows it free (no circle).

## AI-generated cover images

A cover can use an AI-generated "idea" image instead of a photo: set `image.generate` to an
English prompt (keep `image.url` as a fallback photo). Use it whenever an image of the idea hits
harder than a plain photo, like the big AI news accounts do: dramatic, emotional, symbolic scenes
(a hand covering someone's mouth for "forbidden words", rows of blindfolded students for "people
missing out", a person standing over a broken robot for "AI abuse"). Well-known people can appear
in these scenes. Keep the scene clearly symbolic (robots, surreal elements, exaggeration), never a
believable fake photo of a real event that did not happen.
- Logos and mascots are added as badges, not drawn by the model.
- Photorealistic, high contrast, one clear subject, vertical composition, subject in the upper two
  thirds (the bottom third is covered by the headline), no text, no letters, no watermarks.
- At most 2 generated covers per day.

## Utility posts (one per day)

Besides news, queue one evergreen "useful" carousel per New York day (`"format": "utility"`,
`timely: false`, `priority: 2`). These are the posts people save and share. Rotate between:
- Prompt tips: 4 to 6 concrete prompts or prompt patterns for ChatGPT, Claude or Gemini, each with
  what it does. Only patterns that are documented by the vendor or that you can explain clearly.
- Tool lists: 4 to 6 real, free or freemium AI tools or websites, one per slide, each with what it
  does in one sentence. Check every tool's official site exists and matches what you say.
- How-to: step-by-step guide for a feature that launched recently (one step per slide).
Cover headline states the payoff ("5 free AI tools that replace a paid design app"), no false
claims.
Inner slides: when a screenshot of the tool or page exists, use it with `"fit": "contain"` on that
slide's image so it is shown whole instead of cropped.
Caption sources: the official pages of the tools or the vendor's documentation.

## Weekly roundup (Sundays)

On Sunday (New York time), the first run at or after 17:00 queues `YYYY-MM-DD-week-in-ai`:
`"format": "roundup"`, `priority: 1`, `timely: false`, cover headline like
"What happened in AI *this week*", then one inner slide per story (6 stories maximum, so up to
8 slides), each with the story's own photo, a short heading and one or two short paragraphs, built
only from stories that already had jobs this week (reuse their sources). The caption lists the
stories in one line each.

## Reels (`"type": "reel"` jobs)

Mahir sends video links to the Telegram bot; they land in `inbox/links.json`
(`{ id, url, note, received_at }`). Every run, turn each link that no job references yet
(check `link_id` in jobs/) into one Reel job, following his note if he wrote one.

```json
{
  "id": "2026-10-12-figure-robot-laundry-reel",
  "type": "reel",
  "link_id": "link-2026-10-12-1234",
  "created_at": "2026-10-12T18:05:00Z",
  "story_time": "2026-10-12T15:00:00Z",
  "timely": false,
  "sensitive": false,
  "priority": 2,
  "sources": [{ "name": "@creator on X", "url": "https://x.com/creator/status/..." }],
  "video": { "url": "https://x.com/creator/status/...", "start": 0, "max_seconds": 90 },
  "hook": "*Figure's robot* now folds laundry on its own, start to finish",
  "credit": "@creator on X",
  "caption": "...\n\nFollow @neurafeed.ai for daily AI news.\n\nVideo: @creator on X"
}
```

- `hook`: 1 to 2 lines shown above the video, news tone, one *highlighted* key phrase, under 18 words.
  Say what the viewer is seeing. No clickbait, no claims the video does not show.
- `credit` and the caption's last line name the original creator. Always credit.
- If Mahir's note gives a headline (for example `başlık: ...`, `title: ...` or text in quotes), use it as the `hook`: word for word if it is English, a faithful English translation if it is Turkish. Only add the *highlight* asterisks and fix spelling.
- `video.url`: the post URL Mahir sent (yt-dlp downloads it). Optional `start`, `end` (seconds),
  `max_seconds` (default 90).
- If the video is AI-generated, say so in the hook or caption. If you cannot tell what the video
  shows from the post text and Mahir's note, still queue it with a neutral, accurate hook.
- Reels count toward the 4 to 8 posts per day and post in the same prime-time windows.

## Leads

`leads/latest.json` is refreshed every hour by the `scan.yml` Action: hot Reddit posts from
AI subreddits (with score, comment count and image URLs; empty until Reddit API access is
approved), AI stories trending on Hacker News, and the latest items from AI news RSS feeds. Read it first in every run. Reddit shows what people care about; confirm the facts
with real sources before writing.

## Images

Order of preference: images inside the source article, images from the Reddit post about the
story (`i.redd.it` / `preview.redd.it` URLs in leads, credit `via r/<subreddit>`), official
company press images,
then Wikimedia Commons photos of the people or products named in the story
(use the Commons API: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<query>&prop=imageinfo&iiprop=url|size&iiurlwidth=1920`
and copy `thumburl` exactly as returned). Never edit the size in a Wikimedia thumbnail URL:
non-standard widths (for example 1600px) are rejected with HTTP 400. Minimum 1000 px wide. Add 1 or 2 `fallback_urls` per slide.
