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

## Memory (read first)

`memory/notes.md` holds Mahir's saved preferences, standing instructions, past decisions and
operational facts (he manages them from Telegram). Read it at the start of every run and follow
it. It overrides the defaults in this file, but never the "Rules that must never be broken".
Do not edit the memory files yourself.

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
  then 2 short paragraphs, each under 40 words. A `card` holds at most 260 characters of text
  (paragraphs plus note; validation rejects more): split a long story into more slides instead
  of shrinking text, and keep the whole carousel within 8 slides.
- CTA hook: one sentence tied to this specific story, giving a reason to follow.
- Caption: 2 to 4 short lines summarizing the story, one question to drive comments,
  "Follow @neurafeed.ai for daily AI news.", then a final line `Source: <Outlet>` (add
  `· Photo: <credit>` when the photo needs credit).

## Threads text (`threads_text`, every post)

Threads is a conversation app, not a photo feed: the Instagram caption does poorly there. Every
carousel and single post also gets `"threads_text"`: what Threads shows above the same images.
Reels are not posted to Threads (videos get almost no views there), so they need no threads_text.
- 1 to 3 short sentences, at most 420 characters: the news in one sharp line, then one line of
  take or context, then ONE direct question people can answer in a word or a sentence ("Would you
  let an AI agent book your flights?", "Is this the end of free ChatGPT?").
- Plain talk, like a smart person posting, not a press release. No hashtags, no "Follow ...",
  no emojis at the start, no en or em dashes. Facts only from the sources, as everywhere.
- The `Source:` line is added automatically from the caption.

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
    { "kind": "card", "heading": "No more *black boxes*", "paras": ["...", "..."],
      "image": { "url": "https://upload.wikimedia.org/...", "credit": "Brian Smale / CC BY-SA 4.0" } },
    { "kind": "card", "heading": "...", "paras": ["...", { "t": "Bold green takeaway.", "strong": true }],
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
- `site_category` (news jobs): the website category for the article made from this story, one of
  `breaking` (major news everyone is talking about, the first hours), `companies`, `models` (a new
  model, its abilities, benchmarks), `robotics`, `free-tools`, `policy` (laws, lawsuits, government).
- Website: news jobs also become review-only articles on neurafeedai.com, and the site uses the
  carousel's photos as the article's hero image. Prefer photos the site may reuse (Wikimedia
  Commons, the company's own press images, Pexels/Unsplash) and at least 1200 px wide, and always
  fill `credit`.
- 3 to 8 slides. First `cover`, last `cta`. `cover`, `card`, `product` and `text` slides need `image.url`.
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
- Built-in logo library (transparent PNGs, brand colors, use as free badges, no cutout needed):
  `assets/logos/claude.png`, `anthropic.png`, `openai.png`, `meta.png`, `nvidia.png`, `apple.png`.
  For other companies use the sources above.
- Mascots and product characters: when the story is about a product that has an official mascot,
  character or icon (for example Meta's Muse mascot), put it on the cover. Take it from the
  company's own newsroom, press kit, blog post or app store page. Use a round badge
  (`"fit": "contain"`), or, when the file is a transparent PNG, `{ "url": "...", "shape": "free" }`
  so it stands on the photo with no circle. On the cover, free items are placed like a magazine
  collage: leave out `"side"` and `"top"` and the pipeline finds the empty part of the photo
  automatically (set them only to force a spot); optional `"scale"` (default 1). Logos that come
  on a white or colored square get `"cutout": true` so only the mark itself stays. Typical cover: the person in the middle (`pos`), the company's transparent logo
  free on one side, the mascot or product free on the other, never covering a face.
  If the mascot or product image has a background, add `"cutout": true` to that badge: the
  pipeline removes the background automatically and shows it free (no circle).

## Slide kinds (inner slides look like evolving.ai, uncover.ai, chatgptricks)

Inner slides are dark with the text on top and the picture as a rounded card, not text over a
photo. Pick the kind that fits each slide:
- `card` (default for news): `heading` (number it in lists: "1. Just type *@chrome*"), `paras`
  (1 or 2 short paragraphs above the picture), `image` (shown whole as a rounded card, use
  `"fit": "contain"` for screenshots), optional `note` (one short gray line under the picture).
- `product`: one item of a list (a product, a tool, a project, a robot): `image` big on top,
  `heading` as a big green title (2 to 4 words), `paras` (one or two sentences).
- `post`: a real post shown as a card: `author` { `name`, `handle`, `avatar` (photo URL, optional),
  `verified` (only when the account really is verified) }, `platform` ("X", "Threads"...), `text`
  (the post's exact words, never edited or invented), optional `image` (the post's own media),
  optional `date`, optional `heading` above the card. Only posts you actually read.
- `prompt`: `heading` ("2. Ask for a version 2.0"), `paras[0]` (what it is), `prompt` (the exact
  prompt to copy), `paras[1]` (what it does). No picture.
- `summary`: `heading` (default "The *short* version"), `points` (2 to 6 short facts). No picture.
  NOT for normal news carousels. Use it only in a weekly roundup or when Mahir asks for it.
- `text`: the older style, text over a photo. Use only when a strong photo matters more than
  anything else.
- `cta` (last slide): "Follow for more", our account card with the real follower count, `hook`
  (one sentence tied to this story) and "Save for later". No picture needed.
A typical news carousel: cover, 2 to 4 `card` slides (or a `post` when the story is about what
someone posted), then `cta`. No `summary` slide in news carousels.

## Website article (`site_article`, every news carousel)

Every news job (not reels, utility, single, roundup or prompt posts) also carries the article for
neurafeedai.com, written in the same run from the same sources. The site has no other writer: a
story without `site_article` gets no site draft. Mahir approves each article on Telegram before
it goes live, so write it ready to publish.

```json
"site_article": {
  "headline": "Anthropic signs a $45 billion deal for computing power",
  "dek": "One sentence that adds what the headline leaves out.",
  "summary": "Two sentences: what happened and the key number.",
  "seo_title": "Under 65 characters, the main names first",
  "seo_description": "Under 160 characters, what happened in plain words.",
  "answer_summary": "One or two sentences that answer the obvious question directly.",
  "tags": ["Anthropic", "Claude", "AI compute"],
  "hero_alt": "Plain description of the cover photo (what is visible), under 20 words.",
  "paragraphs": [
    { "kind": "fact", "text": "What happened, who, when (absolute date).", "sources": [0, 1] },
    { "kind": "heading", "text": "What the deal covers" },
    { "kind": "fact", "text": "...", "sources": [1] },
    { "kind": "analysis", "text": "What it means, clearly as NeuraFeed's reading, no new facts." },
    { "kind": "why_it_matters", "text": "One concrete thing to watch next." }
  ]
}
```

- 450 to 850 words in `paragraphs`. Do not pad: if the sources support less, write less detail
  in more compact paragraphs, never invented background.
- `sources` are indexes into the job's `sources` array. Every `fact` paragraph cites at least one;
  `analysis`, `heading` and `why_it_matters` cite none. First paragraph is a `fact` (lead with the
  news), last is `why_it_matters`. 1 to 3 `heading`s when they help.
- Voice: a news site, not Instagram. Calm, specific, American English. The headline is factual
  and clear (no hype words, no clickbait; the carousel headline can be dramatic, this one cannot).
  Attribute claims ("according to Reuters", "the company said"). Absolute dates, never "today" or
  "this week". No questions, no "I", "we", "you", no quotes you did not read word for word, no
  en or em dashes, none of: game-changing, groundbreaking, revolutionary, delve into, a testament
  to, only time will tell, it remains to be seen, marks a significant milestone, rapidly evolving
  landscape. Paraphrase; never copy a sentence from a source.
- `hero_alt`: describe the job's main photo as you saw it (no names you cannot see).
- Check with `node -e "const {validateSiteArticle}=require('./src/validate');..."` and fix every
  problem. A problem here does not block the Instagram post, but the site will skip the article.

## Two more formats (like the reference accounts, made from real sources)

- List / gallery (`"format": "list"`): "Claude shared six projects people built", "the most
  impressive inventions on TIME's list", "people are vibe coding their smart TVs". Cover, then one
  `product` (or `card`) slide per item (4 to 6 items), then `cta`. Every item must be real and in a
  source you read, with its own picture. Good for stories with several striking examples.
- Post story (`"format": "posts"`): a story told through what people posted (an argument between
  two CEOs, the internet's reaction to a launch). Cover, then `post` slides with the real posts
  word for word (plus a `card` for context if needed), then `cta`. Link every post in `sources`.
Aim for about one of these a day when a fitting story exists; they count as normal news posts.

## AI-generated cover images

A cover can use an AI-generated "idea" image instead of a photo: set `image.generate` to an
English prompt (keep `image.url` as a fallback photo). Use it whenever an image of the idea hits
harder than a plain photo, like the big AI news accounts do: dramatic, emotional, symbolic scenes
(a hand covering someone's mouth for "forbidden words", rows of blindfolded students for "people
missing out", a person standing over a broken robot for "AI abuse"). Well-known people can appear
in these scenes. Keep the scene clearly symbolic (robots, surreal elements, exaggeration), never a
believable fake photo of a real event that did not happen.
- `image.refs`: 1 to 4 image URLs the model must build the scene from: the company logo, the real
  product or chip photo, the CEO's real photo, the mascot. Always pass refs: the cover must make
  people think of the company in one second (Microsoft's four colored squares, Meta's blue
  infinity logo and the Muse mascot, OpenAI's black knot, Claude's orange asterisk, NVIDIA green).
  Say in the prompt which ref is what ("the man in the first image", "the chip in the second
  image", "the logo in the third image, glowing on the wall") and keep faces and logos exact.
- The model writes fake text on objects (chips, screens, signs). Always say "blank surfaces, no
  readable text or labels on any object" in the prompt.
- Always end the prompt with: "It must look like an unedited real photo from a news agency, not a
  painting, not digital art, no glow effects." and ask for headroom above the person's head
  (the top of the frame is cropped slightly on the cover).
- Photorealistic, high contrast, one clear subject, vertical composition, subject in the upper two
  thirds (the bottom third is covered by the headline), no text, no letters, no watermarks.
- Generated covers are made with Seedream 5.0 Pro (about $0.07 each), no daily limit. The pipeline
  appends realism instructions automatically (candid news photo, grain, real skin, no retouching),
  so write the scene, not the camera style.
- When the story is about a person, the FIRST ref must be a real, recent news photo of that person
  (face clearly visible, at least 800 px) and the prompt calls them "the man/woman in the first
  image". Never generate a known person without their real photo as a ref.
- Logos may be part of the scene when given as a ref (a logo on a crate, a wall, a big screen):
  "the logo from the second image, big and exact". This works well with Seedream. Mascots are never
  drawn by the model: put the real mascot PNG on as a free badge instead.
- Make the scene imperfect and real: a cluttered warehouse, a crowded exchange floor, a dim data
  center aisle, harsh fluorescent light. No clean studio, no perfect symmetry, no glowing sci-fi.

How to choose the cover, for every carousel. Ask two questions about the best real photo:
1. Would someone scrolling know which company or person this is about within one second?
2. Is it striking: a face with emotion, a dramatic moment, a surprising object?
If both are yes, use the real photo (plus logo badge). If either is no (generic chip, server
room, stock image, plain press render, logo on white, no usable photo), generate the cover with
refs. Priority 1 stories about OpenAI, Anthropic, Google, Meta, Microsoft, Apple, NVIDIA or xAI
almost always deserve a generated, brand-heavy cover unless a great real photo exists.

## Utility posts (one per day)

Besides news, queue one evergreen "useful" carousel per New York day (`"format": "utility"`,
`timely: false`, `priority: 2`). These are the posts people save and share. Rotate between:
- Prompt tips: 4 to 6 concrete prompts or prompt patterns for ChatGPT, Claude or Gemini, each with
  what it does, one `prompt` slide each. Only patterns that are documented by the vendor or that you can explain clearly.
- Tool lists: 4 to 6 real, free or freemium AI tools or websites, one per slide, each with what it
  does in one sentence. Check every tool's official site exists and matches what you say.
- How-to: step-by-step guide for a feature that launched recently (one step per slide).
Cover headline states the payoff ("5 free AI tools that replace a paid design app"), no false
claims.
Inner slides: when a screenshot of the tool or page exists, use it with `"fit": "contain"` on that
slide's image so it is shown whole instead of cropped.
Caption sources: the official pages of the tools or the vendor's documentation.

### The guide on the website (`site_article` with `"kind": "guide"`, every utility post)

Every utility carousel also carries a long, evergreen guide for neurafeedai.com (category Guides).
These are the pages people find on Google months later, so they matter more than any single news
article. Same job, same sources; the carousel is the teaser, the guide is the full version.
- Pick the subject from `guides/plan.md`: the first tool or idea not yet covered by a guide job in
  jobs/ (check `site_article.kind == "guide"` and the headline). Popular tools first. Never repeat
  a guide; a new angle on the same tool is fine ("5 Claude prompts for spreadsheets" after a
  general Claude guide).
- Formats: "How to use X: a practical guide", "5 X prompts for Y (copy and paste)", "X vs Y: which
  one for Z", "N things X can do that most people miss". Prompt guides are great: each prompt is a
  `prompt` paragraph the reader copies.
- `paragraphs` kinds: `fact` (what the tool is or does, cites sources, first paragraph), `heading`,
  `step` (`"title": "1. Open a new chat"` plus the text), `prompt` (the exact prompt to copy; may
  have line breaks and placeholders in [brackets]; give it a `title` like "Prompt 3: Turn notes into
  a plan"), `tip` (one practical tip), `analysis`. No `why_it_matters` needed. 700 to 1,600 words.
- Facts only from the vendor's own documentation, help center or announcement, plus at least one
  more source. Never invent a feature, a menu name, a price or a limit; if the docs do not say where
  a button is, do not describe where it is. Say which plan a feature needs when the docs say so.
- Voice: Mahir's voice in English. Short sentences, direct, practical, a little dry. Talk to the
  reader as "you" (guides only). No hype, no filler intros ("In today's fast-paced world"), no
  "unlock", "supercharge", "game-changer", no emojis. Lead with the payoff in the first two lines.
  Say honestly what the tool is bad at. Every step must be something the reader can do right now.
- `headline`: clear and searchable, the tool name first ("ChatGPT Projects: how to set them up and
  when to use them"). `seo_title` under 65 characters, `seo_description` under 160.
- Validate with `validateSiteArticle` like news articles. The desk feed sends it to the site, where
  Mahir approves it on Telegram like any other article.

## Weekly roundup (Sundays)

On Sunday (New York time), the first run at or after 17:00 queues `YYYY-MM-DD-week-in-ai`:
`"format": "roundup"`, `priority: 1`, `timely: false`, cover headline like
"What happened in AI *this week*", then one inner slide per story (6 stories maximum, so up to
8 slides), each with the story's own photo, a short heading and one or two short paragraphs, built
only from stories that already had jobs this week (reuse their sources). The caption lists the
stories in one line each.

## Links from Mahir (Telegram bot)

Mahir sends links to the Telegram bot; they land in `inbox/links.json`
(`{ id, url, note, format, received_at }`). Every run, turn each link that no job references yet
(check `link_id` in jobs/) into exactly one job with `"link_id"` set, before any other work.
If the inbox item has `post_at` (a time Mahir wrote in his note), copy it into the job as
`"post_at"`: the post goes out at that time, at any hour, outside the daily cap. Without `post_at`
a post from his link goes out as soon as he approves it, at any hour. Only when the inbox item has
`"us_window": true` (he chose "first US slot"), copy that into the job: then it waits for the next
posting window. Posts from his links never count toward the 8-per-day news cap.
These are Mahir's own picks: priority 1, and always `"review": true` (he gets a preview on
Telegram and approves before it posts).

Links are normally handled within minutes by the instant link task (the bot starts it when Mahir
sends a link). The regular desk run skips links and requests received less than 30 minutes ago
unless no job has them yet after 30 minutes.

Same story: before queuing ANY job, compare it with every job of the last 3 days (jobs/ and
state/jobs/), including Mahir's link posts. Never queue a story that is already covered, even
from a different source or angle. The pipeline also drops a desk job that shares a source link
with a live post, and withdraws a waiting desk post when Mahir sends the same story himself.

Items made with the bot's step-by-step wizard (`"from": "wizard"`) also have `title` and
`caption` (null when Mahir chose "Claude yazsın"): use `title` as the cover headline or Reel hook
(word for word if English, a faithful English translation if Turkish; only add the *highlight*
asterisks) and `caption` as the caption text (keep his words, add the follow and Source/Video
lines). An item may have `image_file` instead of `url` (a picture Mahir sent, already in the
repo, for example `inbox/uploads/link-....jpg`): make a `"format": "single"` post with that file
as the cover `image.url` (exactly that path) and the headline from `title`; open the picture to
see what it shows. With no title, write a short factual headline about what the picture clearly
shows and nothing more; if you cannot tell, add it to `inbox/skipped.json`.

For links you cannot open yourself (Instagram, Threads), the bot saves what the post shows in
`preview` on the inbox item: `title`, `text` (the caption) and `image_file` (the post's cover
image, for example `inbox/previews/link-....jpg`). Read the caption and open the image file to see
the post. Make our own carousel on that topic from the original sources (search for them). The
cover may follow the same idea and layout as their cover (which elements: a person, a logo, a
mascot, a product, where they sit), built with our own images (real photos or a generated cover
with refs) and our own headline. Never reuse their image, their text or their exact headline.

Instagram, Threads and some sites cannot be opened from here. If you cannot read a link, use
Mahir's note and a web search to find what the post is about and the original news source, and
build the job from that. Never screenshot or copy another account's post or design: always make
our own NeuraFeed version from the original sources. If you still cannot tell what it is about,
do not guess: append `{ "link_id": "...", "url": "...", "reason": "..." }` to
`inbox/skipped.json` (create it as a JSON array if missing) and commit it with the jobs, so Mahir
is told on Telegram.

Which format (`format` field, from a word he wrote anywhere in the message):
- `reel`: a Reel job (below).
- `carousel`: a news carousel (normal job).
- `single`: a single-image post: `"format": "single"`, exactly one `cover` slide, no cta.
- `prompt`: a prompt carousel (`"format": "utility"`, prompt tips, see Utility posts), built
  around the prompt, tool or trick the link shows.
- `auto` (no word): open the link. A video post (X/Instagram/TikTok/YouTube video) becomes a
  Reel; an article, blog post, image post or thread becomes a news carousel.

What to write (headline, slides, caption): read the linked page itself first (article, post text,
thread, video description), then find at least one independent source that confirms it (two for
timely news). Write everything from those sources in the usual NeuraFeed voice. Mahir's note
overrides: `başlık:` / `title:` sets the headline or hook (word for word in English, faithful
translation if Turkish), `caption:` sets the caption text (keep his words, add the closing lines),
and any other words in the note are instructions about angle, tone or what to stress. Never
invent anything the sources do not say. Credit the original creator of a video or image.

## Requests from Mahir and the desk log

Mahir talks to the Telegram bot (DeepSeek). It reads `desk/log.json` and every job file to answer
his questions, and it can send you tasks in `inbox/requests.json`
(`{ id, text, original, job_id, created_at }`; `text` is the task in English, `original` is
his words in Turkish).

Requests: every run, after the links and before other work, handle every OPEN request. A request
is open when its `id` is in `inbox/requests.json`, its status in `state/requests.json` is
`pending` or missing (the pipeline computes it: pending, running, completed, failed), and no file
in jobs/ has that `request_id` yet. Never handle a request twice: if a job with its `request_id`
exists, it is already being made. Failed requests are not retried on your own; Mahir retries by
sending a new request (it has `retry_of`). They are Mahir's own instructions, so they come first.
- Cover a story or make a post on a topic: write the job as usual (all rules apply, sources
  included), `priority: 1`, `"request_id"` set. Not `review` unless he asked to see it first.
- Change a queued post (`job_id` given): write a corrected copy as a NEW job file with id
  `<original id>-v2` (then `-v3`), `"replaces": "<the newest existing version>"` and `"request_id"`. Keep everything he did not
  ask to change, including `story_time`, `priority`, `review`, `link_id` and `post_at`. The pipeline withdraws the old
  one (and every earlier version) before the fix is rendered, and an old version can never be approved or
published again. If the old post is already `posted` (check state/jobs/), do not write a copy: answer `cannot`.
- If a request is impossible or would break a rule (invent facts, copy another account, post
  without sources), answer `cannot` and say why in one sentence. If it needs something you
  cannot do in this run, answer `waiting` with the reason (it stays open for the next run).

Desk log: at the end of EVERY run, also when nothing was queued, add one entry with
`node src/desklog.js <file.json>` (write the file outside the repo, for example in /tmp):
```json
{
  "summary": "One line: what this run did.",
  "considered": [
    { "story": "OpenAI ships GPT-6 mini", "source": "https://...", "decision": "queued", "job_id": "2026-10-15-gpt-6-mini", "priority": 1 },
    { "story": "Startup X raises $20M", "source": "https://...", "decision": "skipped", "reason": "Small funding round, little US interest." },
    { "story": "Gemini 3 Ultra launch", "decision": "covered", "reason": "Already queued as 2026-10-15-gemini-3-ultra." }
  ],
  "requests": [
    { "id": "req-2026-10-15-ab12cd34", "status": "done", "job_id": "2026-10-15-gpt-6-mini-v2", "result": "Changed the cover headline as asked." }
  ]
}
```
List every story you seriously looked at (usually 4 to 15), with an honest one-sentence reason
for each skip, in plain English. Commit `desk/log.json` together with the new jobs (or alone when
nothing was queued). Mahir is told on Telegram when a request is `done` or `cannot`.

## Reels (`"type": "reel"` jobs)

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
- Layout (like evolving.ai / uncover.ai): header, hook, then the video big. A wide video is cropped
  around its center to an almost square box. Set `"video": { ..., "fit": "full" }` when the
  important part is near the left or right edge (a screen recording, text, a chart, two or three
  people side by side), so the whole frame is shown instead. Under the video there is only the
  "Follow @neurafeed.ai" line; the credit goes in the caption's last line.
- Clips with another account's logo (a podcast, interview, TV or conference cut that a page
  reposted with its own branding): use the clean original instead. Find the original video
  on YouTube with a web search (the speaker, the show, the topic, words from the caption) and set
  `"video": { "url": "<the repost URL>", "original": { "url": "<YouTube URL>", "search": ["<show or
  speaker and topic>", "<another query>"] } }`. Give the URL when you found it, the search words
  always. The pipeline transcribes the repost, finds the exact seconds in the original's captions,
  downloads only that part and shows "Original: title, 12:30 to 13:10, match 85%" in Mahir's
  preview. If no match is found it falls back to the repost. Credit the original channel
  (`credit` and the caption's `Video:` line), not the repost page.
- Mahir sends a YouTube link with times ("12:30-13:10"): `video.url` is that link and `start`/`end`
  are those times in seconds (750 and 790). Only that part is downloaded.
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
