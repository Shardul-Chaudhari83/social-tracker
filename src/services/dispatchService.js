// Sends one reminder right now, via whichever contact channel it has.
// Shared by scripts/send_from_file.js (immediate send after file
// processing) and the web UI's "Send Now" button (POST
// /api/reminders/:id/send-now) — one implementation, not two.

const { callMcpTool } = require('../utils/mcpClient');
const reminderService = require('./reminderService');
const { sendTelegramMessage } = require('./telegramService');
const { sendWhatsappMessage } = require('./whatsappService');

function buildReminderMessage(reminder) {
  return [
    `Hi ${reminder.recipient_name},`,
    '',
    'This is an automated reminder for:',
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
 * priority: email -> Telegram -> WhatsApp (email is the primary channel;
 * the others are for when email alone isn't available). Updates the
 * reminder's status/log on success.
 * @param {Object} reminder - a full reminder row (id, recipient_name,
 *   contact_email, contact_telegram_chat_id, contact_phone, task_title,
 *   task_details, due_at, ...)
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

module.exports = { sendReminderNow, buildReminderMessage };
