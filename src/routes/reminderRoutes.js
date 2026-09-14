const express = require('express');
const router = express.Router();
const reminderService = require('../services/reminderService');
const { sendReminderNow } = require('../services/dispatchService');

/**
 * POST /api/reminders
 * Creates a new reminder manually, via webhook, or from email workflow.
 */
router.post('/', (req, res) => {
  try {
    const reminder = reminderService.createReminder(req.body);
    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: reminder
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/reminders
 * List reminders with optional status filter, source filter, search, or active-only flag.
 */
router.get('/', (req, res) => {
  try {
    const { status, source, search, active, limit, offset } = req.query;

    let reminders;
    if (active === 'true' || active === '1') {
      reminders = reminderService.getActiveReminders();
    } else {
      reminders = reminderService.listReminders({
        status,
        source,
        search,
        limit,
        offset
      });
    }

    res.json({
      success: true,
      count: reminders.length,
      data: reminders
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/reminders/active
 * Convenience endpoint for retrieving active reminders.
 */
router.get('/active', (req, res) => {
  try {
    const reminders = reminderService.getActiveReminders();
    res.json({
      success: true,
      count: reminders.length,
      data: reminders
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/reminders/:id
 * Get single reminder with complete escalation logs and reports.
 */
router.get('/:id', (req, res) => {
  try {
    const reminder = reminderService.getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({
        success: false,
        error: `Reminder not found with ID: ${req.params.id}`
      });
    }

    res.json({
      success: true,
      data: reminder
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * PATCH /api/reminders/:id/status
 * Manually or programmatically update reminder state and action metrics.
 */
router.patch('/:id/status', (req, res) => {
  try {
    const { status, ...extraFields } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Field "status" is required in request body'
      });
    }

    const updated = reminderService.updateReminderStatus(req.params.id, status, extraFields);
    res.json({
      success: true,
      message: `Reminder status updated to ${status}`,
      data: updated
    });
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/reminders/:id/send-now
 * Manually sends a reminder immediately via whichever contact channel it
 * has on file (email -> Telegram -> WhatsApp priority), instead of waiting
 * for due_at or the scheduler's poll cycle.
 */
router.post('/:id/send-now', async (req, res) => {
  try {
    const reminder = reminderService.getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({
        success: false,
        error: `Reminder not found with ID: ${req.params.id}`
      });
    }

    const result = await sendReminderNow(reminder);
    if (!result) {
      return res.status(400).json({
        success: false,
        error: 'Reminder has no contact on file (email, Telegram, or WhatsApp) — add one first.'
      });
    }

    res.json({
      success: true,
      message: `Sent via ${result.channel} to ${result.target}`,
      data: reminderService.getReminderById(req.params.id)
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/reminders/:id/logs
 * Record an escalation action (EMAIL_SENT, REPLY_RECEIVED, AI_CALL_PLACED, MANUAL_OVERRIDE).
 */
router.post('/:id/logs', (req, res) => {
  try {
    const { action_type, payload, ai_satisfaction_verdict, call_transcript } = req.body;

    if (!action_type) {
      return res.status(400).json({
        success: false,
        error: 'Field "action_type" is required'
      });
    }

    const logEntry = reminderService.logEscalationAction(
      req.params.id,
      action_type,
      payload,
      ai_satisfaction_verdict,
      call_transcript
    );

    res.status(201).json({
      success: true,
      message: 'Escalation action logged',
      data: logEntry
    });
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/reminders/:id/report
 * Compiles and persists a resolution report.
 */
router.post('/:id/report', (req, res) => {
  try {
    const { summary, final_status, total_time_to_resolve_minutes, escalation_count } = req.body;

    const report = reminderService.createReport({
      reminder_id: req.params.id,
      summary,
      final_status,
      total_time_to_resolve_minutes,
      escalation_count
    });

    res.status(201).json({
      success: true,
      message: 'Report created successfully',
      data: report
    });
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /api/reminders/:id
 * Deletes a reminder and cascade removes all associated logs and reports.
 */
router.delete('/:id', (req, res) => {
  try {
    const deleted = reminderService.deleteReminder(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Reminder not found with ID: ${req.params.id}`
      });
    }

    res.json({
      success: true,
      message: 'Reminder and associated logs deleted successfully'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
