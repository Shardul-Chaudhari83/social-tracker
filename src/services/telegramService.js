// Outbound messaging via the Telegram Bot API — a genuinely free
// alternative to WhatsApp's paid business-initiated template messages
// (Meta charges per "utility conversation" for those; Telegram's Bot API
// has no per-message cost and no template/approval requirement). Used by
// the scheduler as the escalation channel when an email reminder goes
// unanswered.
//
// Unlike a phone number, a Telegram recipient is addressed by numeric
// chat_id, which only exists once they've messaged the bot at least once
// (the free equivalent of Twilio's sandbox "join" step). Use
// getUpdates() / scripts/get_telegram_chat_id.js to discover it.

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getTelegramConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || ''
  };
}

function requireBotToken() {
  const config = getTelegramConfig();
  if (!config.botToken) {
    throw new Error('Telegram bot not configured (TELEGRAM_BOT_TOKEN missing in .env)');
  }
  return config.botToken;
}

/**
 * Sends a plain-text message via the Telegram Bot API. No templates, no
 * approval, no session-window restriction — freeform text works as soon
 * as the recipient has messaged the bot once.
 * @param {Object} params
 * @param {string|number} params.chatId - recipient's Telegram chat id
 * @param {string} params.text - message text
 * @returns {Promise<{messageId: number, chatId: number}>}
 */
async function sendTelegramMessage({ chatId, text }) {
  const botToken = requireBotToken();

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown error'}`);
  }

  return { messageId: data.result.message_id, chatId: data.result.chat.id };
}

/**
 * Fetches pending updates (messages sent to the bot) — used to discover a
 * recipient's chat_id after they message the bot for the first time.
 * @returns {Promise<Array>} raw Telegram update objects
 */
async function getUpdates() {
  const botToken = requireBotToken();

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getUpdates`);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown error'}`);
  }

  return data.result;
}

module.exports = { sendTelegramMessage, getUpdates, getTelegramConfig };
