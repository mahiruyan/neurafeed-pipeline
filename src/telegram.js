// Minimal Telegram Bot API client (no dependencies).
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

const enabled = () => Boolean(TOKEN && CHAT);

async function call(method, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(api(method), {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
  return data.result;
}

function fileBlob(p) {
  return new Blob([fs.readFileSync(p)], { type: p.endsWith('.png') ? 'image/png' : 'image/jpeg' });
}

// Sends the slides as an album (photos for a quick look).
async function sendAlbum(files, asDocuments = false) {
  const form = new FormData();
  form.append('chat_id', CHAT);
  const media = files.slice(0, 10).map((f, i) => ({ type: asDocuments ? 'document' : 'photo', media: `attach://f${i}` }));
  form.append('media', JSON.stringify(media));
  files.slice(0, 10).forEach((f, i) => form.append(`f${i}`, fileBlob(f), path.basename(f)));
  return call('sendMediaGroup', form);
}

async function sendMessage(text, buttons) {
  const body = { chat_id: CHAT, text, disable_web_page_preview: true };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  return call('sendMessage', body);
}

async function editMessage(messageId, text) {
  return call('editMessageText', { chat_id: CHAT, message_id: messageId, text, disable_web_page_preview: true });
}

async function answerCallback(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text });
}

async function getUpdates(offset) {
  return call('getUpdates', { offset, timeout: 0, allowed_updates: ['callback_query', 'message'] });
}

module.exports = { enabled, sendAlbum, sendMessage, editMessage, answerCallback, getUpdates, CHAT };
