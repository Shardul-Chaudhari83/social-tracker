// Minimal owner-name -> contact lookup. The agent pipeline only ever
// produces free-text owner names/roles (e.g. "Rahul Sharma",
// "DevOps / Infrastructure Team"), so something has to map those to a real
// contact_email / contact_phone / telegram chat_id before a reminder can
// actually be messaged.
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

function saveDirectory(directory) {
  fs.writeFileSync(DIRECTORY_PATH, JSON.stringify(directory, null, 2) + '\n', 'utf8');
}

const EMPTY_CONTACT = { email: null, phone: null, telegram: null };

/**
 * Looks up contact info for a free-text owner name/role.
 * @param {string|null} ownerName
 * @returns {{email: string|null, phone: string|null, telegram: string|null}}
 */
function lookupContact(ownerName) {
  if (!ownerName) return EMPTY_CONTACT;

  const directory = loadDirectory();
  const entry = directory[ownerName] || directory[
    Object.keys(directory).find(key => key.toLowerCase() === ownerName.toLowerCase())
  ];

  return entry ? { ...EMPTY_CONTACT, ...entry } : EMPTY_CONTACT;
}

/**
 * Lists every contact in the directory as an array — easier for a
 * frontend to render than the raw name-keyed object.
 * @returns {Array<{name: string, email: string|null, phone: string|null, telegram: string|null}>}
 */
function listContacts() {
  const directory = loadDirectory();
  return Object.entries(directory).map(([name, contact]) => ({ name, ...EMPTY_CONTACT, ...contact }));
}

/**
 * Creates or replaces a contact entry.
 * @param {string} name - owner name/role, exactly as the agent pipeline would produce it
 * @param {{email?: string|null, phone?: string|null, telegram?: string|null}} contact
 * @returns {{name: string, email: string|null, phone: string|null, telegram: string|null}}
 */
function upsertContact(name, contact) {
  if (!name || !name.trim()) {
    throw new Error('name is required');
  }
  const trimmedName = name.trim();
  const directory = loadDirectory();
  directory[trimmedName] = {
    email: contact.email ? contact.email.trim() : null,
    phone: contact.phone ? contact.phone.trim() : null,
    telegram: contact.telegram ? String(contact.telegram).trim() : null
  };
  saveDirectory(directory);
  return { name: trimmedName, ...directory[trimmedName] };
}

/**
 * Removes a contact entry.
 * @param {string} name
 * @returns {boolean} true if a contact was removed
 */
function deleteContact(name) {
  const directory = loadDirectory();
  if (!(name in directory)) return false;
  delete directory[name];
  saveDirectory(directory);
  return true;
}

module.exports = { lookupContact, loadDirectory, listContacts, upsertContact, deleteContact };
