# Guides plan (website Guides category)

The desk writes four guides a day (see CLAUDE.md, "The guide on the website"). Take the first line
not yet covered by a guide job, top to bottom. Mahir can reorder or add lines.

Each line is `target search phrase` → the guide to write. The list comes from Google and Bing
autocomplete research (US English, 2026-11-10, tools/keywords.js, about 9,800 suggestions): the
higher a line, the more often and more widely the phrase showed up. Rules for every line:
- `seo_title` starts with the target phrase (or a very close form) and stays under 65 characters.
- `headline` uses the same phrase in the first words, then the payoff.
- Use the phrase once in the first paragraph and once in a `heading`. Never stuff it.
- Facts only from the vendor's docs, help center or announcement plus one more source. If the
  docs do not support the guide (for example no official way to do something), pick the next line.

## Tool library (Mahir, 2026-11-12: a guide for every popular or promising AI tool)

Alternate: one line from this section, then one from the tiers below, so the site builds a
page for every tool people search for. Phrases come from the second autocomplete run (77 tools,
19,000 suggestions, 2026-11-12), ordered by how much each tool is searched. One guide per line;
when a tool is done, its "vs" line can follow later as a separate guide. You may also add a tool
that is not listed when the news shows it is taking off (check that people search for it first:
a "how to use <tool>" query should autocomplete in a web search).

- `how to use google flow` → How to use Google Flow: AI video with Veo, step by step
- `how to use wispr flow` → How to use Wispr Flow on Mac and Windows: voice typing with AI
- `how to use google ai studio` → How to use Google AI Studio for free
- `how to use adobe firefly` → How to use Adobe Firefly (and Firefly in Photoshop)
- `how to use lm studio` → How to use LM Studio to run AI models on your PC
- `how to use codex` → How to use Codex (ChatGPT's coding agent), including in VS Code
- `how to use claude design` → How to use Claude Design: what it does and how it compares to Figma
- `how to use otter ai` → How to use Otter AI for meeting notes (free plan explained)
- `how to use leonardo ai` → How to use Leonardo AI for free
- `how to use hugging face` → How to use Hugging Face: finding and running AI models
- `how to use grok imagine` → How to use Grok Imagine for images and video
- `how to use copilot studio` → How to use Copilot Studio to build your own agent
- `how to use opus clip` → How to use Opus Clip for free: turn long videos into shorts
- `gemini cli how to install` → Gemini CLI: how to install it and start using it
- `how to use elevenlabs` → How to use ElevenLabs for free: text to speech, step by step
- `how to use comet browser` → How to use Comet, Perplexity's AI browser
- `how to use claude cowork` → How to use Claude Cowork effectively (with prompts)
- `how to use windsurf` → How to use Windsurf, the AI code editor
- `how to use napkin ai` → How to use Napkin AI to turn text into visuals for presentations
- `how to use character ai` → How to use Character AI (and what to do when it is not working)
- `how to use seedance` → How to use Seedance 2.0 for free
- `how to use gamma ai` → How to use Gamma AI to make a presentation in minutes
- `how to use gemini gems` → How to use Gemini Gems effectively (new angle: Gems vs NotebookLM)
- `how to use notion ai` → How to use Notion AI (free limit explained)
- `how to use fireflies ai` → How to use Fireflies AI, and how to remove it from your meetings
- `how to use chatgpt agent mode` → How to use ChatGPT agent mode
- `how to use topaz video ai` → How to use Topaz Video AI to upscale video
- `how to use freepik ai image generator` → How to use Freepik AI image and video generators
- `what is granola ai` → What is Granola AI and how to use it for meeting notes
- `how to use openclaw` → How to use OpenClaw: setup and first prompts
- `how to use manus` → How to use Manus (and how credits work)
- `how to use consensus ai` → How to use Consensus AI for research
- `how to use runway ai` → (already in Tier 1)
- `how to use luma ai dream machine` → How to use Luma AI Dream Machine
- `how to use captions ai` → How to use Captions AI for talking videos
- `how to use openrouter` → How to use OpenRouter (free models and VS Code setup)
- `how to use qwen` → How to use Qwen AI and Qwen Code
- `how to use descript` → How to use Descript to edit video by editing text
- `how to use heygen` → How to use HeyGen to make an AI avatar video
- `how to use replit` → How to use Replit Agent to build an app
- `how to use gptzero` → How to use GPTZero (and how accurate AI detectors are)
- `how to use kimi` → How to use Kimi AI
- `how to use base44` → How to use Base44 to build an app for free
- `how to use elicit for literature review` → How to use Elicit for a literature review
- `how to use genspark` → How to use Genspark AI for free
- `how to use jules` → How to use Jules, Google's coding agent
- `how to use devin ai` → How to use Devin AI
- `how to use photoroom` → How to use Photoroom for product photos
- `how to use magnific ai` → How to use Magnific AI to upscale images
- `how to use vercel v0` → How to use Vercel v0 for free (plan limits explained)
- `how to use synthesia` → How to use Synthesia, and is it worth it
- `how to use le chat` → How to use Le Chat, Mistral's assistant
- `how to use invideo ai` → How to use InVideo AI for free
- `how to use hailuo ai` → How to use Hailuo AI for free
- `how to use ideogram` → How to use Ideogram for free: images with readable text
- `how to use lindy` → How to use Lindy AI to build an assistant
- `how to use framer ai` → How to use Framer AI website builder
- `how to pass mercor ai interview` → Mercor: what it is and how the AI interview works
- `how to use krea` → How to use Krea for free
- `udio vs suno` → Udio vs Suno: which AI music maker
- `how to use chatpdf` → How to use ChatPDF for free
- `how to use gumloop` → How to use Gumloop for AI automations
- `how to use scite ai for literature review` → How to use Scite AI for a literature review
- `how to use arcads ai` → How to use Arcads AI for ad videos
- `how to use turnitin ai checker` → How Turnitin's AI checker works (and Turnitin vs GPTZero)
- `quillbot vs grammarly` → QuillBot vs Grammarly: which writing AI
- Names Mahir gave that need checking first (write the guide only if the tool's own site and docs
  can be found and read): Instinct, Spacefast, Grok bots/companions.

Strong "vs" phrases from the same run, for after the tool's own guide: `codex vs claude code`,
`windsurf vs cursor`, `heygen vs synthesia`, `lm studio vs ollama`, `otter ai vs fireflies`,
`wispr flow vs superwhisper`, `comet browser vs atlas`, `claude cowork vs claude code`,
`seedance vs kling`, `adobe firefly vs midjourney`, `replit vs lovable`, `gumloop vs n8n`,
`descript vs capcut`, `opus clip vs capcut`, `gptzero vs turnitin`.

## Tier 1: hot tools, "how to use" (highest demand)
- `how to use chatgpt atlas` → How to use ChatGPT Atlas: the AI browser, step by step
- `chatgpt atlas for windows` → ChatGPT Atlas for Windows: how to download, install and set it up
- `how to use gemini nano banana` → How to use Gemini Nano Banana for free: edit and create images
- `gemini nano banana not working` → Gemini Nano Banana not working: fixes that actually help
- `how to use higgsfield ai` → How to use Higgsfield AI (and what you get for free)
- `zapier ai agents` → Zapier AI agents: how to build your first one, with examples
- `how to use deepseek` → How to use DeepSeek safely: app, web and what to keep private
- `how to use capcut ai` → How to use CapCut AI: auto captions, AI video maker and clipper
- `how to use kling ai` → How to use Kling AI to make videos (free credits explained)
- `how to use n8n` → How to use n8n for free: your first AI automation in 20 minutes
- `how to use canva ai` → How to use Canva AI: presentations, images and Magic Studio
- `how to use runway ai` → How to use Runway AI video generator: a beginner guide
- `how to use meta ai in whatsapp` → How to use Meta AI in WhatsApp (and how to turn it off)
- `how to use sora` → How to use Sora: making AI videos from text, step by step
- `how to use veo 3 for free` → How to use Veo for free: Google's AI video in Gemini and Flow
- `how to use lovable` → How to use Lovable to build an app without coding
- `ollama how to use` → How to use Ollama to run AI models on your own computer
- `how to use suno` → How to use Suno to make a song from a prompt

## Tier 2: "vs" comparisons (people deciding what to pay for)
- `chatgpt vs claude` → ChatGPT vs Claude: which one is better for what (tested)
- `gemini vs chatgpt` → Gemini vs ChatGPT: which AI assistant to use in 2026
- `cursor vs claude code` → Cursor vs Claude Code: which AI coding tool to pick
- `claude code vs codex` → Claude Code vs OpenAI Codex: features, price and limits
- `chatgpt atlas vs comet` → ChatGPT Atlas vs Perplexity Comet: which AI browser
- `perplexity vs chatgpt` → Perplexity vs ChatGPT for research and search
- `n8n vs zapier` → n8n vs Zapier: which automation tool for AI workflows
- `bolt new vs lovable` → Bolt.new vs Lovable: which AI app builder
- `grok vs chatgpt` → Grok vs ChatGPT: where each one wins
- `deepseek vs chatgpt` → DeepSeek vs ChatGPT: price, privacy and quality
- `midjourney vs nano banana` → Midjourney vs Nano Banana: which image AI
- `notebooklm vs gemini` → NotebookLM vs Gemini: when to use which
- `ollama vs lm studio` → Ollama vs LM Studio: running AI locally
- `kling vs seedance` → Kling vs Seedance: which AI video model
- `ai agent vs agentic ai` → AI agent vs agentic AI: the difference in plain words

## Tier 3: prompt packs (copy and paste)
- `prompts for chatgpt images` → 10 ChatGPT image prompts that come out right (copy and paste)
- `prompts for claude code` → 8 Claude Code prompts for real projects (copy and paste)
- `gemini nano banana prompts` → 10 Gemini Nano Banana prompts for photo edits
- `meta ai prompts for images` → Meta AI image prompts that work, with examples
- `prompts for perplexity ai` → 7 Perplexity prompts for faster research
- `midjourney prompts for realistic photos` → Midjourney prompts for realistic photos
- `prompts for chatgpt to sound more human` → ChatGPT prompts to make writing sound human
- `best lovable prompts` → Best Lovable prompts to build an app faster
- `best canva ai prompts` → Best Canva AI prompts for designs and presentations
- `prompts for grok` → Grok prompts for images, video and research
- `notebooklm prompts for notes` → NotebookLM prompts for better notes and study guides

## Tier 4: problems, limits, cancel (high intent, little competition)
- `claude limits` → Claude usage limits explained: what each plan gets
- `chatgpt image limit` → ChatGPT image limit: how many images you can make per plan
- `perplexity how to cancel subscription` → How to cancel a Perplexity subscription (web, iPhone, Android)
- `chatgpt cancel subscription` → How to cancel ChatGPT Plus or Pro (and keep your chats)
- `claude cancel subscription` → How to cancel a Claude subscription
- `chatgpt error in message stream` → ChatGPT "error in message stream": what it means and fixes
- `claude not working` → Claude not working: how to check and fix it
- `chatgpt how to delete all chats` → How to delete all ChatGPT chats (and your memory)
- `meta ai how to delete` → How to delete Meta AI chats and limit what it sees
- `cursor limits` → Cursor plans and limits explained

## Tier 5: alternatives (free first)
- `chatgpt alternative free` → Free ChatGPT alternatives that are actually good
- `midjourney alternative free` → Free Midjourney alternatives for AI images
- `elevenlabs alternative free` → Free ElevenLabs alternatives for AI voice
- `canva ai alternative free` → Free Canva AI alternatives
- `zapier alternatives` → Zapier alternatives for AI automation (free and cheap)
- `notebooklm alternatives` → NotebookLM alternatives for studying and research
- `claude code alternatives` → Claude Code alternatives: other AI coding agents

## Already covered (do not repeat)
ChatGPT everyday work (Projects, memory, files) · Claude Projects and artifacts · Gemini Gems ·
Perplexity research · NotebookLM (Gemini Notebook) · Microsoft Copilot · Grok · Cursor for
beginners · Claude Code install · GitHub Copilot in VS Code · Midjourney prompts · ChatGPT Images ·
ElevenLabs voice cloning
