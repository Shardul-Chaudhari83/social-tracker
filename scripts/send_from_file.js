#!/usr/bin/env node
/**
 * Reads a file's raw text, runs it through the same 4-agent pipeline the
 * web UI uses, resolves (or interactively asks for) each recipient's
 * contact, creates a real reminder for the audit trail, and sends it
 * immediately — no waiting for due_at or the background scheduler.
 *
 * Usage:
 *   node scripts/send_from_file.js <path-to-file>
 *
 * Contact resolution, per item:
 *   1. Look up the owner in src/config/owner-directory.json (email first,
 *      then Telegram, then WhatsApp phone — same priority the rest of the
 *      system uses).
 *   2. If nothing is on file, ask right here in the terminal which channel
 *      and number/chat_id to use, or to skip sending for that item.
 *
 * Items that fail QA after 3 retries ("Needs Human Review") are still
 * shown in the summary but are never sent, same as everywhere else in
 * this system.
 *
 * IMPORTANT: this sends real messages (email via your configured SMTP
 * account, Telegram via your bot, or WhatsApp via Twilio if you choose
 * it interactively and have TWILIO_WHATSAPP_TEMPLATE_SID configured —
 * see scripts/test_phase4_whatsapp.js for why WhatsApp needs that and
 * may incur a charge).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { initDatabase, closeDatabase } = require('../src/db/database');
const reminderService = require('../src/services/reminderService');
const { runAgentPipeline } = require('../src/services/pipelineService');
const { resolveDueDate } = require('../src/utils/deadlineResolver');
const { lookupContact } = require('../src/services/ownerDirectoryService');
const { ensureMcpServer } = require('../src/utils/ensureMcpServer');
const { callMcpTool } = require('../src/utils/mcpClient');
const { sendTelegramMessage } = require('../src/services/telegramService');
const { sendWhatsappMessage } = require('../src/services/whatsappService');

function askQuestion(rl, query) {
  return new Promise(resolve => rl.question(query, resolve));
}

/**
 * Interactively asks which channel/number to use for a recipient with no
 * saved contact. Returns a contact object ({email, phone, telegram}, all
 * nullable) or null if the user chose to skip.
 */
async function promptForContact(rl, ownerName, taskTitle) {
  console.log(`\n⚠️  No saved contact found for "${ownerName}".`);
  console.log(`   Task: "${taskTitle}"`);
  console.log('   Send via: [1] Telegram chat_id   [2] WhatsApp number   [3] Skip (don\'t send)');
  const choice = (await askQuestion(rl, '   > ')).trim();

  if (choice === '1') {
    const chatId = (await askQuestion(rl, '   Enter Telegram chat_id: ')).trim();
    return chatId ? { email: null, phone: null, telegram: chatId } : null;
  }
  if (choice === '2') {
    const phone = (await askQuestion(rl, '   Enter WhatsApp phone number (E.164, e.g. +15551234567): ')).trim();
    return phone ? { email: null, phone, telegram: null } : null;
  }
  return null;
}

function buildReminderMessage(reminder) {
  return [
    `Hi ${reminder.recipient_name},`,
    '',
    `This is an automated reminder for:`,
    '',
    `"${reminder.task_title}"`,
    reminder.task_details,
    '',
    `Due: ${reminder.due_at}`,
    '',
    '— Automated Reminder System'
  ].join('\n');
}

/**
 * Sends a reminder immediately via whichever contact channel it has,
 * priority: email -> Telegram -> WhatsApp (same priority as the rest of
 * the system: email is the primary channel, the others are for when email
 * alone isn't available). Updates the reminder's status/log on success.
 * @returns {Promise<{channel: string, target: string}|null>} null if the
 *   reminder has no contact at all (nothing to send to)
 */
async function sendReminderNow(reminder) {
  if (reminder.contact_email) {
    const subject = `Reminder: ${reminder.task_title}`;
    const body = buildReminderMessage(reminder);
    await callMcpTool('send_email', { to: reminder.contact_email, subject, body });
    reminderService.updateReminderStatus(reminder.id, 'MESSAGED');
    reminderService.logEscalationAction(reminder.id, 'EMAIL_SENT', { to: reminder.contact_email, subject });
    return { channel: 'email', target: reminder.contact_email };
  }

  if (reminder.contact_telegram_chat_id) {
    await sendTelegramMessage({ chatId: reminder.contact_telegram_chat_id, text: buildReminderMessage(reminder) });
    reminderService.updateReminderStatus(reminder.id, 'MESSAGED');
    reminderService.logEscalationAction(reminder.id, 'TELEGRAM_SENT', { chatId: reminder.contact_telegram_chat_id });
    return { channel: 'telegram', target: reminder.contact_telegram_chat_id };
  }

  if (reminder.contact_phone) {
    await sendWhatsappMessage({
      to: reminder.contact_phone,
      body: buildReminderMessage(reminder),
      contentVariables: { 1: reminder.task_title, 2: new Date(reminder.due_at).toLocaleString() }
    });
    reminderService.updateReminderStatus(reminder.id, 'MESSAGED');
    reminderService.logEscalationAction(reminder.id, 'WHATSAPP_SENT', { to: reminder.contact_phone });
    return { channel: 'whatsapp', target: reminder.contact_phone };
  }

  return null;
}

async function main() {
  const [, , filePath] = process.argv;

  if (!filePath) {
    console.error('Usage: node scripts/send_from_file.js <path-to-file>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const fileText = fs.readFileSync(resolvedPath, 'utf8');
  if (!fileText.trim()) {
    console.error(`File is empty: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`[1/3] Reading ${resolvedPath} (${fileText.length} chars)...`);
  initDatabase();

  console.log('[2/3] Running the agent pipeline (Extraction -> Assignment -> QA)...\n');
  const { processedItems } = await runAgentPipeline(fileText, {
    onEvent: event => console.log(`  [${event.agent}] ${event.message}`)
  });

  const verifiedItems = processedItems.filter(item => item.status === 'Verified');
  const flaggedItems = processedItems.filter(item => item.status !== 'Verified');

  console.log(`\n[3/3] ${verifiedItems.length} verified item(s), ${flaggedItems.length} flagged for human review.\n`);

  if (flaggedItems.length > 0) {
    console.log('Flagged (not sent — needs a human to fill the gaps):');
    flaggedItems.forEach(item => console.log(`  - "${item.task}" (${item.flagReason || 'unspecified reason'})`));
    console.log('');
  }

  if (verifiedItems.length === 0) {
    console.log('Nothing to send.');
    closeDatabase();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const mcpChild = await ensureMcpServer();
  const results = [];

  try {
    for (const item of verifiedItems) {
      const dueDate = resolveDueDate(item.deadline);
      let contact = lookupContact(item.owner);

      if (!contact.email && !contact.phone && !contact.telegram) {
        try {
          const provided = await promptForContact(rl, item.owner, item.task);
          contact = provided || { email: null, phone: null, telegram: null };
        } catch (err) {
          // e.g. stdin closed unexpectedly (ERR_USE_AFTER_CLOSE) — treat as
          // skip rather than aborting every remaining item in the file.
          console.error(`   ⚠️  Could not prompt for contact (${err.message}) — skipping send for this item.`);
          contact = { email: null, phone: null, telegram: null };
        }
      }

      const reminder = reminderService.createReminder({
        source: 'file-cli',
        recipient_name: item.owner,
        contact_email: contact.email,
        contact_phone: contact.phone,
        contact_telegram_chat_id: contact.telegram,
        task_title: item.task.length > 140 ? item.task.slice(0, 137) + '...' : item.task,
        task_details: item.rawSnippet,
        due_at: dueDate.toISOString(),
        status: 'PENDING'
      });

      console.log(`\n📌 Reminder created for "${item.owner}": ${reminder.id}`);

      try {
        const sendResult = await sendReminderNow(reminder);
        if (sendResult) {
          console.log(`   ✅ Sent via ${sendResult.channel} -> ${sendResult.target}`);
          results.push({ owner: item.owner, task: item.task, channel: sendResult.channel, status: 'sent' });
        } else {
          console.log('   ⏭️  Skipped — no contact provided.');
          results.push({ owner: item.owner, task: item.task, channel: '-', status: 'skipped (no contact)' });
        }
      } catch (err) {
        console.error(`   ❌ Send failed: ${err.message}`);
        results.push({ owner: item.owner, task: item.task, channel: '-', status: `failed: ${err.message}` });
      }
    }
  } finally {
    rl.close();
    if (mcpChild) mcpChild.kill();
    closeDatabase();
  }

  console.log('\n--- Summary ---');
  results.forEach(r => console.log(`  ${r.owner} | "${r.task.slice(0, 60)}" | ${r.channel} | ${r.status}`));
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { main, sendReminderNow, promptForContact, buildReminderMessage };
