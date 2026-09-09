// Minimal owner-name -> contact lookup. The agent pipeline only ever
// produces free-text owner names/roles (e.g. "Rahul Sharma",
// "DevOps / Infrastructure Team"), so something has to map those to a real
// contact_email/contact_phone before a reminder can actually be messaged.
//
// This is a flat-file stand-in for a real directory/CRM lookup. Edit
// src/config/owner-directory.json to add more people/teams. An owner not
// found here still gets a reminder created (so it's visible in the UI) —
// it just has no contact info, so the scheduler will skip sending until
// one is added.

const fs = require('fs');
const path = require('path');

const DIRECTORY_PATH = path.join(__dirname, '..', 'config', 'owner-directory.json');

function loadDirectory() {
  try {
    const raw = fs.readFileSync(DIRECTORY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[OwnerDirectory] Failed to load owner-directory.json:', err.message);
    return {};
  }
}

/**
 * Looks up contact info for a free-text owner name/role.
 * @param {string|null} ownerName
 * @returns {{email: string|null, phone: string|null}}
 */
function lookupContact(ownerName) {
  if (!ownerName) return { email: null, phone: null };

  const directory = loadDirectory();
  if (directory[ownerName]) return directory[ownerName];

  const caseInsensitiveKey = Object.keys(directory).find(
    key => key.toLowerCase() === ownerName.toLowerCase()
  );

  return caseInsensitiveKey ? directory[caseInsensitiveKey] : { email: null, phone: null };
}

module.exports = { lookupContact, loadDirectory };
