const crypto = require('crypto');
const { getDatabase } = require('../db/database');

const VALID_REMINDER_STATUSES = [
  'PENDING',
  'MESSAGED',
  'SATISFIED',
  'NEEDS_ESCALATION',
  'CALL_SCHEDULED',
  'CALL_COMPLETED',
  'RESOLVED',
  'FAILED'
];

const ACTIVE_STATUSES = ['PENDING', 'MESSAGED', 'CALL_SCHEDULED'];

const VALID_ACTION_TYPES = [
  'EMAIL_SENT',
  'REPLY_RECEIVED',
  'AI_CALL_PLACED',
  'MANUAL_OVERRIDE'
];

const VALID_AI_VERDICTS = ['SATISFIED', 'UNSATISFIED', 'UNCLEAR'];

const VALID_REPORT_STATUSES = ['COMPLETED', 'ESCALATED_UNRESOLVED'];

/**
 * Creates a new reminder in the persistence layer.
 * @param {Object} data - Reminder properties
 * @returns {Object} Newly created reminder
 */
function createReminder(data) {
  const db = getDatabase();

  if (!data) {
    throw new Error('Reminder data is required');
  }

  const {
    recipient_name,
    task_title,
    task_details,
    due_at,
    source = 'manual',
    contact_email = null,
    contact_phone = null,
    status = 'PENDING',
    escalation_attempts = 0
  } = data;

  // Validation
  if (!recipient_name || typeof recipient_name !== 'string' || !recipient_name.trim()) {
    throw new Error('recipient_name is required and must be a non-empty string');
  }
  if (!task_title || typeof task_title !== 'string' || !task_title.trim()) {
    throw new Error('task_title is required and must be a non-empty string');
  }
  if (!task_details || typeof task_details !== 'string' || !task_details.trim()) {
    throw new Error('task_details is required and must be a non-empty string');
  }
  if (!due_at) {
    throw new Error('due_at is required (valid ISO date string or timestamp)');
  }

  const parsedDueDate = new Date(due_at);
  if (isNaN(parsedDueDate.getTime())) {
    throw new Error('due_at must be a valid date format');
  }

  const normalizedStatus = status.toUpperCase();
  if (!VALID_REMINDER_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid status: "${status}". Must be one of: ${VALID_REMINDER_STATUSES.join(', ')}`);
  }

  const id = data.id || crypto.randomUUID();
  const dueAtIso = parsedDueDate.toISOString();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO reminders (
      id, source, recipient_name, contact_email, contact_phone,
      task_title, task_details, due_at, status, escalation_attempts,
      last_action_at, created_at, updated_at
    ) VALUES (
      @id, @source, @recipient_name, @contact_email, @contact_phone,
      @task_title, @task_details, @due_at, @status, @escalation_attempts,
      @last_action_at, @created_at, @updated_at
    )
  `);

  stmt.run({
    id,
    source: source.trim(),
    recipient_name: recipient_name.trim(),
    contact_email: contact_email ? contact_email.trim() : null,
    contact_phone: contact_phone ? contact_phone.trim() : null,
    task_title: task_title.trim(),
    task_details: task_details.trim(),
    due_at: dueAtIso,
    status: normalizedStatus,
    escalation_attempts: Number(escalation_attempts) || 0,
    last_action_at: data.last_action_at ? new Date(data.last_action_at).toISOString() : null,
    created_at: now,
    updated_at: now
  });

  return getReminderById(id);
}

/**
 * Retrieves a single reminder by ID with its escalation logs and reports.
 * @param {string} id - UUID of reminder
 * @returns {Object|null} Reminder object with logs and reports
 */
function getReminderById(id) {
  const db = getDatabase();

  const reminderStmt = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const reminder = reminderStmt.get(id);

  if (!reminder) {
    return null;
  }

  const logsStmt = db.prepare('SELECT * FROM escalation_logs WHERE reminder_id = ? ORDER BY created_at ASC');
  const logs = logsStmt.all(id).map(log => {
    let parsedPayload = log.payload;
    try {
      if (log.payload) {
        parsedPayload = JSON.parse(log.payload);
      }
    } catch {
      // Retain as raw string if not JSON
    }
    return {
      ...log,
      payload: parsedPayload
    };
  });

  const reportsStmt = db.prepare('SELECT * FROM reports WHERE reminder_id = ? ORDER BY generated_at DESC');
  const reports = reportsStmt.all(id);

  return {
    ...reminder,
    escalation_logs: logs,
    reports: reports,
    latest_report: reports.length > 0 ? reports[0] : null
  };
}

/**
 * Retrieves all active reminders (PENDING, MESSAGED, CALL_SCHEDULED).
 * @returns {Array} List of active reminders sorted by due_at ascending
 */
function getActiveReminders() {
  const db = getDatabase();
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT * FROM reminders 
    WHERE status IN (${placeholders}) 
    ORDER BY due_at ASC
  `);

  return stmt.all(...ACTIVE_STATUSES);
}

/**
 * Lists all reminders with optional filtering.
 * @param {Object} filters - Optional filters (status, source, search, limit, offset)
 * @returns {Array} List of reminders
 */
function listReminders(filters = {}) {
  const db = getDatabase();
  const { status, source, search, limit = 50, offset = 0 } = filters;

  const conditions = [];
  const params = [];

  if (status) {
    if (Array.isArray(status)) {
      const placeholders = status.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...status.map(s => s.toUpperCase()));
    } else if (typeof status === 'string' && status.includes(',')) {
      const statuses = status.split(',').map(s => s.trim().toUpperCase());
      const placeholders = statuses.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...statuses);
    } else {
      conditions.push('status = ?');
      params.push(status.toUpperCase());
    }
  }

  if (source) {
    conditions.push('source = ?');
    params.push(source.toLowerCase());
  }

  if (search) {
    conditions.push('(recipient_name LIKE ? OR task_title LIKE ? OR task_details LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  let sql = 'SELECT * FROM reminders';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

/**
 * Updates status and optional fields for a reminder.
 * @param {string} id - UUID of reminder
 * @param {string} newStatus - New reminder status
 * @param {Object} extraFields - Optional extra fields (last_action_at, escalation_attempts, etc.)
 * @returns {Object} Updated reminder
 */
function updateReminderStatus(id, newStatus, extraFields = {}) {
  const db = getDatabase();

  const current = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  if (!current) {
    throw new Error(`Reminder not found with id: ${id}`);
  }

  const normalizedStatus = newStatus.toUpperCase();
  if (!VALID_REMINDER_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid status: "${newStatus}". Must be one of: ${VALID_REMINDER_STATUSES.join(', ')}`);
  }

  const updates = ['status = ?', "updated_at = datetime('now')"];
  const params = [normalizedStatus];

  if (extraFields.last_action_at !== undefined) {
    updates.push('last_action_at = ?');
    params.push(extraFields.last_action_at ? new Date(extraFields.last_action_at).toISOString() : null);
  } else {
    // Default last_action_at to now if state transitioned to action states
    if (['MESSAGED', 'CALL_SCHEDULED', 'CALL_COMPLETED', 'SATISFIED', 'RESOLVED'].includes(normalizedStatus)) {
      updates.push("last_action_at = datetime('now')");
    }
  }

  if (extraFields.escalation_attempts !== undefined) {
    updates.push('escalation_attempts = ?');
    params.push(Number(extraFields.escalation_attempts));
  } else if (extraFields.increment_escalation) {
    updates.push('escalation_attempts = escalation_attempts + 1');
  }

  if (extraFields.task_title !== undefined) {
    updates.push('task_title = ?');
    params.push(extraFields.task_title.trim());
  }

  if (extraFields.task_details !== undefined) {
    updates.push('task_details = ?');
    params.push(extraFields.task_details.trim());
  }

  if (extraFields.due_at !== undefined) {
    const parsedDate = new Date(extraFields.due_at);
    if (isNaN(parsedDate.getTime())) {
      throw new Error('due_at must be a valid date');
    }
    updates.push('due_at = ?');
    params.push(parsedDate.toISOString());
  }

  params.push(id);

  const sql = `UPDATE reminders SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);

  return getReminderById(id);
}

/**
 * Logs an escalation action against a reminder.
 * @param {string} reminderId - Reminder UUID
 * @param {string} actionType - 'EMAIL_SENT' | 'REPLY_RECEIVED' | 'AI_CALL_PLACED' | 'MANUAL_OVERRIDE'
 * @param {any} payload - Message content, webhook payload, or metadata
 * @param {string|null} verdict - 'SATISFIED' | 'UNSATISFIED' | 'UNCLEAR' | null
 * @param {string|null} transcript - Call transcript or reply text
 * @returns {Object} Created escalation log entry
 */
function logEscalationAction(reminderId, actionType, payload = null, verdict = null, transcript = null) {
  const db = getDatabase();

  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(reminderId);
  if (!reminder) {
    throw new Error(`Cannot log action: Reminder not found with id: ${reminderId}`);
  }

  const normalizedAction = actionType ? actionType.toUpperCase() : '';
  if (!VALID_ACTION_TYPES.includes(normalizedAction)) {
    throw new Error(`Invalid actionType: "${actionType}". Must be one of: ${VALID_ACTION_TYPES.join(', ')}`);
  }

  let normalizedVerdict = null;
  if (verdict) {
    normalizedVerdict = verdict.toUpperCase();
    if (!VALID_AI_VERDICTS.includes(normalizedVerdict)) {
      throw new Error(`Invalid ai_satisfaction_verdict: "${verdict}". Must be one of: ${VALID_AI_VERDICTS.join(', ')}`);
    }
  }

  const logId = crypto.randomUUID();
  const serializedPayload = payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null;
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO escalation_logs (
      id, reminder_id, action_type, payload, ai_satisfaction_verdict, call_transcript, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(logId, reminderId, normalizedAction, serializedPayload, normalizedVerdict, transcript || null, now);

  // Update last_action_at and updated_at on reminder
  db.prepare(`
    UPDATE reminders 
    SET last_action_at = ?, updated_at = ? 
    WHERE id = ?
  `).run(now, now, reminderId);

  return {
    id: logId,
    reminder_id: reminderId,
    action_type: normalizedAction,
    payload: payload,
    ai_satisfaction_verdict: normalizedVerdict,
    call_transcript: transcript || null,
    created_at: now
  };
}

/**
 * Compiles and persists a resolution/summary report for a reminder.
 * @param {Object} reportData - Report fields
 * @returns {Object} Created report entry
 */
function createReport(reportData) {
  const db = getDatabase();

  if (!reportData) {
    throw new Error('Report data is required');
  }

  const {
    reminder_id,
    summary,
    final_status,
    total_time_to_resolve_minutes = null,
    escalation_count = null
  } = reportData;

  if (!reminder_id) {
    throw new Error('reminder_id is required');
  }

  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(reminder_id);
  if (!reminder) {
    throw new Error(`Cannot create report: Reminder not found with id: ${reminder_id}`);
  }

  if (!summary || typeof summary !== 'string' || !summary.trim()) {
    throw new Error('summary is required and must be a non-empty string');
  }

  const normalizedStatus = final_status ? final_status.toUpperCase() : '';
  if (!VALID_REPORT_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid final_status: "${final_status}". Must be one of: ${VALID_REPORT_STATUSES.join(', ')}`);
  }

  // Calculate resolution time if not explicitly passed
  let resolvedMinutes = total_time_to_resolve_minutes;
  if (resolvedMinutes === null || resolvedMinutes === undefined) {
    const createdTime = new Date(reminder.created_at).getTime();
    const nowTime = Date.now();
    resolvedMinutes = Math.max(1, Math.round((nowTime - createdTime) / 60000));
  }

  // Calculate escalation count if not provided
  let count = escalation_count;
  if (count === null || count === undefined) {
    count = reminder.escalation_attempts || 0;
  }

  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO reports (
      id, reminder_id, summary, total_time_to_resolve_minutes, escalation_count, final_status, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(reportId, reminder_id, summary.trim(), resolvedMinutes, count, normalizedStatus, now);

  // Update reminder status to RESOLVED or FAILED corresponding to report
  const reminderFinalStatus = normalizedStatus === 'COMPLETED' ? 'RESOLVED' : 'FAILED';
  db.prepare('UPDATE reminders SET status = ?, updated_at = ? WHERE id = ?').run(reminderFinalStatus, now, reminder_id);

  return {
    id: reportId,
    reminder_id,
    summary: summary.trim(),
    total_time_to_resolve_minutes: resolvedMinutes,
    escalation_count: count,
    final_status: normalizedStatus,
    generated_at: now
  };
}

/**
 * Deletes a reminder and cascades to logs and reports.
 * @param {string} id - UUID
 * @returns {boolean} True if deleted
 */
function deleteReminder(id) {
  const db = getDatabase();
  const res = db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
  return res.changes > 0;
}

module.exports = {
  VALID_REMINDER_STATUSES,
  ACTIVE_STATUSES,
  VALID_ACTION_TYPES,
  VALID_AI_VERDICTS,
  VALID_REPORT_STATUSES,
  createReminder,
  getReminderById,
  getActiveReminders,
  listReminders,
  updateReminderStatus,
  logEscalationAction,
  createReport,
  deleteReminder
};
