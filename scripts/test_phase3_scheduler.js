#!/usr/bin/env node
/**
 * Manual test harness for the Phase 3 reminder scheduler
 * (src/services/schedulerService.js).
 *
 * Uses a dedicated test database (data/test_scheduler.db) so it never
 * touches your real reminders. Reuses an already-running MCP Email Server
 * on port 3001 if one exists, otherwise spins up a temporary one and
 * kills it when done.
 *
 * IMPORTANT: "send" mode sends a real email via your configured SMTP
 * account to whatever address you pass. Only point it at an address you
 * control and are OK receiving a test email at.
 *
 * Usage:
 *   node scripts/test_phase3_scheduler.js send <recipient-email> [recipient-name]
 *   node scripts/test_phase3_scheduler.js check-replies
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_scheduler.db');
process.env.DB_PATH = TEST_DB_PATH;

const { initDatabase, closeDatabase } = require('../src/db/database');
const reminderService = require('../src/services/reminderService');
const schedulerService = require('../src/services/schedulerService');
const { ensureMcpServer } = require('../src/utils/ensureMcpServer');

async function runSend(recipientEmail, recipientName) {
  initDatabase(TEST_DB_PATH);

  const reminder = reminderService.createReminder({
    source: 'test',
    recipient_name: recipientName,
    contact_email: recipientEmail,
    task_title: 'Phase 3 Scheduler Test Reminder',
    task_details: 'This is a test reminder sent by scripts/test_phase3_scheduler.js to verify the outbound email + reply-detection loop.',
    due_at: new Date(Date.now() - 60000).toISOString(), // 1 minute in the past -> immediately due
    status: 'PENDING'
  });
  console.log(`[Test] Created test reminder ${reminder.id} for ${recipientEmail}`);

  const mcpChild = await ensureMcpServer();

  try {
    console.log('[Test] Running checkDueReminders()...');
    await schedulerService.checkDueReminders();

    const updated = reminderService.getReminderById(reminder.id);
    console.log(`\n[Test] Reminder status after send attempt: ${updated.status}`);
    console.log('[Test] Escalation logs:', JSON.stringify(updated.escalation_logs, null, 2));

    if (updated.status === 'MESSAGED') {
      console.log(`\n✅ Email sent successfully to ${recipientEmail}.`);
      console.log('   Reply to it from that same address, then run:');
      console.log('   node scripts/test_phase3_scheduler.js check-replies');
    } else {
      console.log('\n⚠️ Email was not sent — see the error logged above (likely an SMTP credential issue).');
    }
  } finally {
    if (mcpChild) mcpChild.kill();
    closeDatabase();
  }
}

async function runCheckReplies() {
  if (!fs.existsSync(TEST_DB_PATH)) {
    console.log('[Test] No test database found — run "send" first.');
    return;
  }

  initDatabase(TEST_DB_PATH);
  const mcpChild = await ensureMcpServer();

  try {
    const awaitingReply = reminderService.listReminders({ status: 'MESSAGED' });
    console.log(`[Test] ${awaitingReply.length} reminder(s) awaiting a reply. Checking inbox...`);

    await schedulerService.checkForReplies();

    const satisfied = reminderService.listReminders({ status: 'SATISFIED' });
    console.log(`\n[Test] Reminders now marked SATISFIED: ${satisfied.length}`);
    satisfied.forEach(r => console.log(`  - ${r.id}: "${r.task_title}"`));

    if (satisfied.length === 0) {
      console.log('   (No matching reply found yet — make sure you replied from the same address the reminder used, then try again.)');
    }
  } finally {
    if (mcpChild) mcpChild.kill();
    closeDatabase();
  }
}

async function main() {
  const [, , mode, arg1, arg2] = process.argv;

  if (mode === 'send') {
    if (!arg1) {
      console.error('Usage: node scripts/test_phase3_scheduler.js send <recipient-email> [recipient-name]');
      process.exit(1);
    }
    await runSend(arg1, arg2 || 'Test Recipient');
  } else if (mode === 'check-replies') {
    await runCheckReplies();
  } else {
    console.log('Usage:');
    console.log('  node scripts/test_phase3_scheduler.js send <recipient-email> [recipient-name]');
    console.log('  node scripts/test_phase3_scheduler.js check-replies');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Test] Fatal error:', err);
  process.exit(1);
});
