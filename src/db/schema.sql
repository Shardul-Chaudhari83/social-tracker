-- Automated Reminder Management System - Database Schema (SQLite)

PRAGMA foreign_keys = ON;

-- 1. Reminders Table
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'manual',
    recipient_name TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    task_title TEXT NOT NULL,
    task_details TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN (
            'PENDING',
            'MESSAGED',
            'SATISFIED',
            'NEEDS_ESCALATION',
            'CALL_SCHEDULED',
            'CALL_COMPLETED',
            'RESOLVED',
            'FAILED'
        )
    ),
    escalation_attempts INTEGER NOT NULL DEFAULT 0,
    last_action_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indices for Reminders
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_due_at ON reminders(due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_created_at ON reminders(created_at);

-- 2. Escalation Logs Table
CREATE TABLE IF NOT EXISTS escalation_logs (
    id TEXT PRIMARY KEY,
    reminder_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (
        action_type IN (
            'EMAIL_SENT',
            'REPLY_RECEIVED',
            'AI_CALL_PLACED',
            'MANUAL_OVERRIDE'
        )
    ),
    payload TEXT,
    ai_satisfaction_verdict TEXT CHECK (
        ai_satisfaction_verdict IN ('SATISFIED', 'UNSATISFIED', 'UNCLEAR') OR ai_satisfaction_verdict IS NULL
    ),
    call_transcript TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
);

-- Indices for Escalation Logs
CREATE INDEX IF NOT EXISTS idx_escalation_logs_reminder_id ON escalation_logs(reminder_id);
CREATE INDEX IF NOT EXISTS idx_escalation_logs_created_at ON escalation_logs(created_at);

-- 3. Reports Table
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reminder_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    total_time_to_resolve_minutes INTEGER,
    escalation_count INTEGER NOT NULL DEFAULT 0,
    final_status TEXT NOT NULL CHECK (
        final_status IN ('COMPLETED', 'ESCALATED_UNRESOLVED')
    ),
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
);

-- Indices for Reports
CREATE INDEX IF NOT EXISTS idx_reports_reminder_id ON reports(reminder_id);
