// Outbound WhatsApp messaging via Twilio's WhatsApp API. Used by the
// scheduler as the escalation channel when an email reminder goes
// unanswered — same "outbound-only for now" scope as Phase 3's email
// sending: there's no inbound webhook yet, so WhatsApp replies aren't
// detected automatically (see the README note this phase ships with).

const twilio = require('twilio');

function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886', // Twilio sandbox number
    templateSid: process.env.TWILIO_WHATSAPP_TEMPLATE_SID || ''
  };
}

let cachedClient = null;
let cachedClientSid = null;

function getClient() {
  const config = getTwilioConfig();
  if (!config.accountSid || !config.authToken) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing in .env)');
  }
  if (!cachedClient || cachedClientSid !== config.accountSid) {
    cachedClient = twilio(config.accountSid, config.authToken);
    cachedClientSid = config.accountSid;
  }
  return cachedClient;
}

// Twilio's WhatsApp channel needs the "whatsapp:" prefix on both numbers.
// Accepts a bare E.164 number ("+15551234567") or an already-prefixed one.
function toWhatsappAddress(phoneNumber) {
  const trimmed = phoneNumber.trim();
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

/**
 * Sends a WhatsApp message via Twilio.
 *
 * WhatsApp Business Platform requires business-initiated messages (like our
 * reminders — the recipient hasn't just messaged us) to use a pre-approved
 * Content Template, referenced by ContentSid, not free-text. Plain `body`
 * only works when replying inside a session the recipient opened themselves
 * within the last 24h. If TWILIO_WHATSAPP_TEMPLATE_SID is configured, this
 * sends via that template with `contentVariables`; otherwise it falls back
 * to freeform `body` (only useful for in-session replies).
 *
 * @param {Object} params
 * @param {string} params.to - recipient phone number, E.164 (e.g. "+15551234567")
 * @param {string} [params.body] - plain-text body (freeform, session-only)
 * @param {Object} [params.contentVariables] - template variable map, e.g. {1: "...", 2: "..."}
 * @returns {Promise<{sid: string, status: string}>}
 */
async function sendWhatsappMessage({ to, body, contentVariables }) {
  const config = getTwilioConfig();
  const client = getClient();

  const payload = {
    from: toWhatsappAddress(config.from),
    to: toWhatsappAddress(to)
  };

  if (config.templateSid) {
    payload.contentSid = config.templateSid;
    payload.contentVariables = JSON.stringify(contentVariables || {});
  } else {
    if (!body) {
      throw new Error('No TWILIO_WHATSAPP_TEMPLATE_SID configured and no body provided — WhatsApp requires a template for business-initiated messages');
    }
    payload.body = body;
  }

  const message = await client.messages.create(payload);

  return { sid: message.sid, status: message.status };
}

module.exports = { sendWhatsappMessage, getTwilioConfig };
