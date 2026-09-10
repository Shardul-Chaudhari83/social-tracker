#!/usr/bin/env node
/**
 * Manual test harness for Phase 4 (Telegram escalation) — the live,
 * zero-cost replacement for WhatsApp (see scripts/test_phase4_whatsapp.js
 * for why: WhatsApp charges per business-initiated message even in
 * Twilio's sandbox; Telegram's Bot API has no such cost).
 *
 * Two modes:
 *
 *   node scripts/test_phase4_telegram.js send <chat-id>
 *     Sends one Telegram message directly via telegramService — the
 *     simplest possible check that your bot token works and the
 *     recipient has messaged the bot at least once.
 *
 *   node scripts/test_phase4_telegram.js escalate <chat-id> [name]
 *     Exercises the real escalation path: creates a MESSAGED reminder
 *     whose last_action_at is already past REMINDER_ESCALATION_TIMEOUT_MS,
 *     then runs schedulerService.checkForEscalations() against it — the
 *     same code path the live scheduler runs on its own poll loop.
 *     Uses an isolated test DB (data/test_telegram.db), never your real one.
 *
 * Don't have a chat_id yet? Message your bot on Telegram once, then run:
 *   node scripts/get_telegram_chat_id.js
 *
 * IMPORTANT: both modes send a real Telegram message via your configured
 * bot to whatever chat_id you pass — free, but still a real message to a
 * real person.
 */

require('dotenv').config();
const path = require('path');
const { sendTelegramMessage } = require('../src/services/telegramService');

async function runSend(chatId) {
  console.log(`[Test] Sending a Telegram message directly to chat_id ${chatId}...`);
  const result = await sendTelegramMessage({
    chatId,
    text: 'This is a test message from the Email-Tracker reminder system (Phase 4 Telegram check).'
  });
  console.log('[Test] Telegram accepted the message:', result);
}

async function runEscalate(chatId, name) {
  const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_telegram.db');
  process.env.DB_PATH = TEST_DB_PATH;

  const { initDatabase, closeDatabase } = require('../src/db/database');
  const reminderService = require('../src/services/reminderService');
  const { checkForEscalations } = require('../src/services/schedulerService');

  initDatabase(TEST_DB_PATH);

  // last_action_at set further back than the escalation timeout so this
  // reminder is immediately eligible for escalation.
  const timeoutMs = parseInt(process.env.REMINDER_ESCALATION_TIMEOUT_MS || String(24 * 60 * 60 * 1000), 10);
  const staleTime = new Date(Date.now() - timeoutMs - 60000).toISOString();

  const reminder = reminderService.createReminder({
    source: 'test',
    recipient_name: name,
    contact_telegram_chat_id: chatId,
    task_title: 'Phase 4 Escalation Test Reminder',
    task_details: 'This reminder was created already-stale to verify the email -> Telegram escalation path.',
    due_at: staleTime,
    status: 'MESSAGED',
    last_action_at: staleTime
  });
  console.log(`[Test] Created stale MESSAGED reminder ${reminder.id} for chat_id ${chatId} (last_action_at: ${staleTime})`);

  console.log('[Test] Running checkForEscalations()...');
  await checkForEscalations();

  const updated = reminderService.getReminderById(reminder.id);
  console.log(`\n[Test] Reminder status after escalation check: ${updated.status}`);
  console.log('[Test] Escalation logs:', JSON.stringify(updated.escalation_logs, null, 2));

  if (updated.status === 'MESSAGED' && updated.escalation_logs.some(l => l.action_type === 'TELEGRAM_SENT')) {
    console.log(`\n✅ Escalated successfully — Telegram message sent to chat_id ${chatId}.`);
  } else {
    console.log('\n⚠️ Escalation did not result in a TELEGRAM_SENT log — see errors above.');
  }

  closeDatabase();
}

async function main() {
  const [, , mode, chatId, name] = process.argv;

  if (mode === 'send') {
    if (!chatId) {
      console.error('Usage: node scripts/test_phase4_telegram.js send <chat-id>');
      process.exit(1);
    }
    await runSend(chatId);
  } else if (mode === 'escalate') {
    if (!chatId) {
      console.error('Usage: node scripts/test_phase4_telegram.js escalate <chat-id> [name]');
      process.exit(1);
    }
    await runEscalate(chatId, name || 'Test Recipient');
  } else {
    console.log('Usage:');
    console.log('  node scripts/test_phase4_telegram.js send <chat-id>');
    console.log('  node scripts/test_phase4_telegram.js escalate <chat-id> [name]');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Test] Fatal error:', err.message);
  process.exit(1);
});
