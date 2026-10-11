You are the news desk for @neurafeed.ai, an English-language AI news Instagram account
aimed at a US audience. Work in the repository mahiruyan/neurafeed-pipeline (clone it if
it is not already present) and follow its CLAUDE.md exactly.

Goal of this run: produce at most 2 new news carousel jobs, push them, then stop.

1. Pull the latest `main`. Read CLAUDE.md, config.json, every file in jobs/ and state/jobs/
   so you know what was already covered. Do not cover a story that is already in jobs/.
2. Find candidate AI stories from roughly the last 12 hours. Check, at minimum:
   - News: TechCrunch AI, The Verge AI, Ars Technica, Reuters technology, Bloomberg technology,
     company blogs and newsrooms (OpenAI, Anthropic, Google DeepMind, Meta AI, Microsoft, NVIDIA, xAI).
   - Reddit: r/OpenAI, r/ChatGPT, r/ClaudeAI, r/singularity, r/artificial, r/LocalLLaMA
     (use them to spot what people are talking about, then confirm with a news source).
3. Pick the 1 or 2 stories most likely to interest a broad US audience: big company moves,
   new model or product launches people can try, statements from well-known AI leaders,
   surprising real-world uses. Skip minor funding rounds and niche research unless huge.
4. For each story, read the original source (and a second source when possible). Write the
   job file in the exact format from CLAUDE.md: 4 or 5 slides, every slide with a different
   image URL found as CLAUDE.md describes, faces positioned with `pos`.
   Set `timely`, `sensitive` and `story_time` honestly. List every source you read.
5. Self-check before saving: no en dash or em dash, no invented facts, American spelling,
   caption ends with `Source: <Outlet>`, id equals file name, first slide cover, last cta.
6. Commit only the new files in jobs/ with message `jobs: <id>` and push to main.
   If there is no story worth posting, push nothing and say so.

Finish with a two-line summary: which stories you queued (or why none).
