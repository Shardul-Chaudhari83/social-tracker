const express = require('express');
const router = express.Router();
const ownerDirectoryService = require('../services/ownerDirectoryService');

/**
 * GET /api/contacts
 * Lists every contact in the owner directory.
 */
router.get('/', (req, res) => {
  try {
    const contacts = ownerDirectoryService.listContacts();
    res.json({ success: true, count: contacts.length, data: contacts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/contacts
 * Creates or replaces a contact. Body: { name, email?, phone?, telegram? }
 */
router.post('/', (req, res) => {
  try {
    const { name, email, phone, telegram } = req.body;
    const contact = ownerDirectoryService.upsertContact(name, { email, phone, telegram });
    res.status(201).json({ success: true, message: 'Contact saved', data: contact });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/contacts/:name
 * Removes a contact.
 */
router.delete('/:name', (req, res) => {
  try {
    const deleted = ownerDirectoryService.deleteContact(req.params.name);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Contact not found: ${req.params.name}` });
    }
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
