#!/usr/bin/env node
/**
 * Discovers Telegram chat_id values by reading pending updates on your bot.
 *
 * Usage:
 *   1. Message @BotFather -> /newbot -> get a bot token -> put it in
 *      .env as TELEGRAM_BOT_TOKEN
 *   2. From the phone/account you want reminders sent to, open your bot
 *      in Telegram and send it any message (e.g. "hi")
 *   3. Run: node scripts/get_telegram_chat_id.js
 *
 * Telegram only queues the last ~24h of updates the bot hasn't already
 * fetched, so send the message shortly before running this.
 */

require('dotenv').config();
const { getUpdates } = require('../src/services/telegramService');

async function main() {
  const updates = await getUpdates();

  if (updates.length === 0) {
    console.log('No pending messages found. Send your bot a message on Telegram first, then run this again.');
    return;
  }

  console.log(`Found ${updates.length} update(s):\n`);
  updates.forEach(update => {
    const message = update.message || update.edited_message;
    if (!message) return;
    const chat = message.chat;
    const from = message.from;
    console.log(`chat_id: ${chat.id}`);
    console.log(`  from: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'no username'})`.trim());
    console.log(`  text: "${message.text || ''}"`);
    console.log('');
  });

  console.log('Use the chat_id above as the recipient\'s Telegram contact in owner-directory.json or the test script.');
}

main().catch(err => {
  console.error('Failed to fetch Telegram updates:', err.message);
  process.exit(1);
});
