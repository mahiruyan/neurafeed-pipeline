#!/usr/bin/env bash
# Commits the given paths and pushes to main, safely while others push too (the Telegram bot,
# the news desk, other workflows). Queue files in inbox/ merge by item id (src/mergelist.js), so a
# rebase never stops on them. Retries with back-off; fails loudly (and tells Telegram) only if the
# state really could not be saved, because then a later run would work from old state.
# Usage: scripts/save.sh "<commit message>" <path>...
set -u
msg="$1"; shift
git config user.name "neurafeed-bot"
git config user.email "neurafeed-bot@users.noreply.github.com"
git config merge.jsonlist.name "merge JSON lists by id"
git config merge.jsonlist.driver "node src/mergelist.js %O %A %B"
for p in "$@"; do [ -e "$p" ] && git add -A -- "$p"; done
git diff --cached --quiet && { echo "Nothing to save."; exit 0; }
git commit -q -m "$msg [skip ci]"
for i in 1 2 3 4 5 6; do
  if git pull -q --rebase --autostash origin main && git push -q origin HEAD:main; then
    echo "Saved on attempt $i."; exit 0
  fi
  git rebase --abort 2>/dev/null || true
  sleep $((i * 4))
done
echo "::error::Could not save state after 6 attempts"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -d chat_id="$TELEGRAM_CHAT_ID" \
    --data-urlencode "text=🚨 ${GITHUB_WORKFLOW:-pipeline}: could not save state to GitHub. Check the run: ${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}" >/dev/null || true
fi
exit 1
