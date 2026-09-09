const { callMcpTool } = require('../utils/mcpClient');
const reminderService = require('./reminderService');
const { sendWhatsappMessage } = require('./whatsappService');

// How often to poll for due reminders / inbox replies (default: 1 minute).
const POLL_INTERVAL_MS = parseInt(process.env.REMINDER_POLL_INTERVAL_MS || '60000', 10);

// How long an emailed reminder can go unanswered before escalating to
// WhatsApp (default: 24 hours). Lower this for testing.
const ESCALATION_TIMEOUT_MS = parseInt(process.env.REMINDER_ESCALATION_TIMEOUT_MS || String(24 * 60 * 60 * 1000), 10);

let pollTimer = null;

/**
 * Finds PENDING reminders whose due_at has passed and sends the first
 * reminder email for each, transitioning them to MESSAGED.
 */
async function checkDueReminders() {
  const due = reminderService.getDueReminders();

  for (const reminder of due) {
    if (!reminder.contact_email) {
      console.log(`[Scheduler] Skipping reminder ${reminder.id} ("${reminder.task_title}") — no contact_email on file`);
      continue;
    }

    const subject = `Reminder: ${reminder.task_title}`;
    const body = [
      `Hi ${reminder.recipient_name},`,
      '',
      `This is an automated reminder that the following task is due:`,
      '',
      `"${reminder.task_title}"`,
      reminder.task_details,
      '',
      `Due: ${reminder.due_at}`,
      '',
      `Please reply to this email once it's done, or to flag any blockers.`,
      '',
      '— Automated Reminder System'
    ].join('\n');

    try {
      await callMcpTool('send_email', { to: reminder.contact_email, subject, body });
      reminderService.updateReminderStatus(reminder.id, 'MESSAGED');
      reminderService.logEscalationAction(reminder.id, 'EMAIL_SENT', { to: reminder.contact_email, subject });
      console.log(`[Scheduler] Sent reminder email for "${reminder.task_title}" -> ${reminder.contact_email}`);
    } catch (err) {
      console.error(`[Scheduler] Failed to send reminder ${reminder.id}:`, err.message);
    }
  }
}

/**
 * Finds MESSAGED reminders and checks the inbox for a reply from the
 * recipient's contact_email received after the reminder was sent.
 * A matching reply marks the reminder SATISFIED.
 */
async function checkForReplies() {
  const messaged = reminderService.listReminders({ status: 'MESSAGED' });
  if (messaged.length === 0) return;

  let emails;
  try {
    const inboxData = await callMcpTool('list_inbox_messages', { limit: 15 });
    emails = inboxData.emails || [];
  } catch (err) {
    console.error('[Scheduler] Failed to fetch inbox for reply check:', err.message);
    return;
  }

  for (const reminder of messaged) {
    if (!reminder.contact_email) continue;

    const sentAt = reminder.last_action_at ? new Date(reminder.last_action_at).getTime() : 0;
    const reply = emails.find(email => {
      const fromAddress = (email.from || '').toLowerCase();
      const emailTime = new Date(email.date).getTime();
      return fromAddress.includes(reminder.contact_email.toLowerCase()) && emailTime > sentAt;
    });

    if (reply) {
      reminderService.updateReminderStatus(reminder.id, 'SATISFIED');
      reminderService.logEscalationAction(reminder.id, 'REPLY_RECEIVED', {
        emailId: reply.id,
        from: reply.from,
        subject: reply.subject
      });
      console.log(`[Scheduler] Reply detected for reminder ${reminder.id} from ${reply.from}`);
    }
  }
}

/**
 * Finds MESSAGED reminders whose email has gone unanswered past
 * ESCALATION_TIMEOUT_MS and escalates them to WhatsApp. A reminder with no
 * contact_phone on file is moved to NEEDS_ESCALATION instead — visible in
 * the UI as needing a human to add a contact number or intervene manually.
 * (WhatsApp is outbound-only for now — there's no inbound webhook yet, so
 * a WhatsApp reply won't be auto-detected the way an email reply is.)
 */
async function checkForEscalations() {
  const cutoff = new Date(Date.now() - ESCALATION_TIMEOUT_MS).toISOString();
  const stale = reminderService.getStaleMessagedReminders(cutoff);

  for (const reminder of stale) {
    if (!reminder.contact_phone) {
      reminderService.updateReminderStatus(reminder.id, 'NEEDS_ESCALATION', { increment_escalation: true });
      console.log(`[Scheduler] Reminder ${reminder.id} ("${reminder.task_title}") unanswered and has no contact_phone — flagged NEEDS_ESCALATION`);
      continue;
    }

    const body = [
      `Hi ${reminder.recipient_name}, following up on: "${reminder.task_title}"`,
      reminder.task_details,
      `Due: ${reminder.due_at}`,
      `We emailed you about this and haven't heard back — please reply here or by email once it's done.`
    ].join('\n');

    try {
      await sendWhatsappMessage({ to: reminder.contact_phone, body });
      reminderService.updateReminderStatus(reminder.id, 'MESSAGED', { increment_escalation: true });
      reminderService.logEscalationAction(reminder.id, 'WHATSAPP_SENT', { to: reminder.contact_phone });
      console.log(`[Scheduler] Escalated reminder ${reminder.id} to WhatsApp -> ${reminder.contact_phone}`);
    } catch (err) {
      console.error(`[Scheduler] Failed to escalate reminder ${reminder.id} to WhatsApp:`, err.message);
    }
  }
}

async function runPollCycle() {
  try {
    await checkDueReminders();
    await checkForReplies();
    await checkForEscalations();
  } catch (err) {
    console.error('[Scheduler] Poll cycle error:', err.message);
  }
}

/**
 * Starts the periodic poll loop. Safe to call once at server startup.
 */
function startScheduler() {
  if (pollTimer) return; // already running
  console.log(`[Scheduler] Reminder scheduler started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  runPollCycle();
  pollTimer = setInterval(runPollCycle, POLL_INTERVAL_MS);
}

function stopScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkDueReminders,
  checkForReplies,
  checkForEscalations
};
