#!/usr/bin/env node
/**
 * Standalone Twilio WhatsApp connectivity check — NOT wired into the live
 * scheduler. The project switched its escalation channel to Telegram
 * (see scripts/test_phase4_telegram.js) because WhatsApp Business
 * Platform charges per business-initiated message (Meta's "utility
 * conversation" billing applies even to Twilio's sandbox templates), which
 * doesn't fit a zero-budget project. This script is kept for whenever
 * there's budget to revisit WhatsApp as an additional channel.
 *
 * Usage:
 *   node scripts/test_phase4_whatsapp.js send <phone-e164>
 *
 * Sends one WhatsApp message directly via whatsappService. Needs
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM in .env,
 * and (per WhatsApp's template requirement for business-initiated
 * messages) TWILIO_WHATSAPP_TEMPLATE_SID — see the Content Template
 * Builder in the Twilio Console. Without a template SID this only works
 * if you're replying inside a session the recipient opened themselves in
 * the last 24h.
 *
 * IMPORTANT: sends a real WhatsApp message via your configured Twilio
 * account to whatever number you pass, and — if a template is configured —
 * may incur a real charge on your Twilio account.
 */

require('dotenv').config();
const { sendWhatsappMessage } = require('../src/services/whatsappService');

async function runSend(phone) {
  console.log(`[Test] Sending a WhatsApp message directly to ${phone}...`);
  if (process.env.TWILIO_WHATSAPP_TEMPLATE_SID) {
    console.log(`[Test] Using content template ${process.env.TWILIO_WHATSAPP_TEMPLATE_SID} (this may incur a charge on your Twilio account)`);
  } else {
    console.log('[Test] No TWILIO_WHATSAPP_TEMPLATE_SID set — sending freeform body (only works inside an active session window).');
  }
  const result = await sendWhatsappMessage({
    to: phone,
    body: 'This is a test message from the Email-Tracker reminder system (WhatsApp connectivity check).',
    // Mapped to the sandbox's default "Appointment Reminders" template ({{1}} at {{2}})
    contentVariables: { 1: 'WhatsApp connectivity test', 2: new Date().toLocaleString() }
  });
  console.log('[Test] Twilio accepted the message:', result);
  console.log(`   sid: ${result.sid}, status: ${result.status}`);
  console.log('   (status is usually "queued" or "accepted" right after sending — check your phone.)');
}

async function main() {
  const [, , mode, phone] = process.argv;

  if (mode !== 'send' || !phone) {
    console.log('Usage: node scripts/test_phase4_whatsapp.js send <phone-e164>');
    process.exit(1);
  }

  await runSend(phone);
}

main().catch(err => {
  console.error('[Test] Fatal error:', err.message);
  process.exit(1);
});
