const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use temporary in-memory or dedicated test database
const testDbPath = path.join(__dirname, '..', 'data', 'test_reminders.db');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

process.env.DB_PATH = testDbPath;

const { initDatabase, closeDatabase } = require('../src/db/database');
const reminderService = require('../src/services/reminderService');
const app = require('../server');

async function runTests() {
  console.log('🧪 Starting Phase 1 Verification Test Suite...\n');

  // Initialize test database
  initDatabase(testDbPath);
  console.log('✓ Database and schema initialized successfully.');

  // Test 1: createReminder
  console.log('\n--- 1. Testing createReminder ---');
  const reminderData = {
    source: 'email',
    recipient_name: 'Rahul Sharma',
    contact_email: 'rahul@example.com',
    contact_phone: '+15551234567',
    task_title: 'Complete User Migration Script',
    task_details: 'Migrate legacy user records and verify integrity checks',
    due_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'PENDING'
  };

  const created = reminderService.createReminder(reminderData);
  assert.ok(created.id, 'Reminder ID should be generated (UUID)');
  assert.strictEqual(created.recipient_name, 'Rahul Sharma');
  assert.strictEqual(created.status, 'PENDING');
  assert.strictEqual(created.escalation_attempts, 0);
  assert.ok(Array.isArray(created.escalation_logs));
  assert.strictEqual(created.escalation_logs.length, 0);
  console.log('✓ createReminder succeeded:', created.id);

  // Test 1.1: Validation failure handling
  assert.throws(() => {
    reminderService.createReminder({ task_title: 'Missing recipient' });
  }, /recipient_name is required/, 'Should reject missing recipient_name');

  assert.throws(() => {
    reminderService.createReminder({
      recipient_name: 'Alex',
      task_title: 'Invalid status',
      task_details: 'Some details',
      due_at: new Date().toISOString(),
      status: 'INVALID_STATUS'
    });
  }, /Invalid status/, 'Should reject invalid status enum');
  console.log('✓ Validation constraints properly enforced.');

  // Test 2: Additional Reminders for List & Active Queries
  console.log('\n--- 2. Testing getActiveReminders & listReminders ---');
  const reminder2 = reminderService.createReminder({
    source: 'manual',
    recipient_name: 'DevOps Ops Team',
    contact_email: 'ops@techcorp.com',
    task_title: 'Renew SSL Certificates',
    task_details: 'Renew load balancer TLS/SSL cert before expiry',
    due_at: new Date(Date.now() + 3600000).toISOString(),
    status: 'MESSAGED'
  });

  const reminder3 = reminderService.createReminder({
    source: 'webhook',
    recipient_name: 'Elena Rostova',
    task_title: 'Update Onboarding Documentation',
    task_details: 'Revise API documentation sections',
    due_at: new Date(Date.now() + 172800000).toISOString(),
    status: 'RESOLVED'
  });

  const activeReminders = reminderService.getActiveReminders();
  assert.strictEqual(activeReminders.length, 2, 'Should return exactly 2 active reminders (PENDING, MESSAGED)');
  assert.strictEqual(activeReminders[0].id, reminder2.id, 'Earlier due date should come first');
  console.log('✓ getActiveReminders returned active items in due date order.');

  const filtered = reminderService.listReminders({ status: 'RESOLVED' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, reminder3.id);

  const searched = reminderService.listReminders({ search: 'Certificates' });
  assert.strictEqual(searched.length, 1);
  assert.strictEqual(searched[0].id, reminder2.id);
  console.log('✓ listReminders filtered and searched correctly.');

  // Test 3: updateReminderStatus
  console.log('\n--- 3. Testing updateReminderStatus ---');
  const updated = reminderService.updateReminderStatus(created.id, 'CALL_SCHEDULED', {
    increment_escalation: true
  });
  assert.strictEqual(updated.status, 'CALL_SCHEDULED');
  assert.strictEqual(updated.escalation_attempts, 1);
  assert.ok(updated.last_action_at, 'last_action_at should be populated');
  console.log('✓ updateReminderStatus updated state and incremented attempts.');

  // Test 4: logEscalationAction
  console.log('\n--- 4. Testing logEscalationAction ---');
  const emailLog = reminderService.logEscalationAction(
    created.id,
    'EMAIL_SENT',
    { subject: 'Reminder: Complete User Migration Script', templateId: 'remind_v1' },
    null,
    null
  );
  assert.ok(emailLog.id);
  assert.strictEqual(emailLog.action_type, 'EMAIL_SENT');

  const replyLog = reminderService.logEscalationAction(
    created.id,
    'REPLY_RECEIVED',
    { from: 'rahul@example.com', raw: 'Still working on it, will need 2 more hours' },
    'UNSATISFIED',
    'Still working on it, will need 2 more hours'
  );
  assert.strictEqual(replyLog.ai_satisfaction_verdict, 'UNSATISFIED');

  const callLog = reminderService.logEscalationAction(
    created.id,
    'AI_CALL_PLACED',
    { duration_seconds: 45, phone: '+15551234567' },
    'SATISFIED',
    'Agent: Have you finished the migration? Rahul: Yes, completed and verified 10 minutes ago.'
  );
  assert.strictEqual(callLog.ai_satisfaction_verdict, 'SATISFIED');

  const refreshedReminder = reminderService.getReminderById(created.id);
  assert.strictEqual(refreshedReminder.escalation_logs.length, 3);
  assert.strictEqual(refreshedReminder.escalation_logs[0].action_type, 'EMAIL_SENT');
  assert.strictEqual(refreshedReminder.escalation_logs[1].action_type, 'REPLY_RECEIVED');
  assert.strictEqual(refreshedReminder.escalation_logs[2].action_type, 'AI_CALL_PLACED');
  console.log('✓ logEscalationAction tracked complete escalation timeline.');

  // Test 5: createReport
  console.log('\n--- 5. Testing createReport ---');
  const report = reminderService.createReport({
    reminder_id: created.id,
    summary: 'Task completed following voice AI escalation call confirmation.',
    final_status: 'COMPLETED',
    total_time_to_resolve_minutes: 120,
    escalation_count: 2
  });
  assert.ok(report.id);
  assert.strictEqual(report.final_status, 'COMPLETED');
  assert.strictEqual(report.total_time_to_resolve_minutes, 120);

  const finalizedReminder = reminderService.getReminderById(created.id);
  assert.strictEqual(finalizedReminder.status, 'RESOLVED');
  assert.ok(finalizedReminder.latest_report);
  assert.strictEqual(finalizedReminder.latest_report.summary, report.summary);
  console.log('✓ createReport compiled resolution metrics and set reminder status to RESOLVED.');

  // Test 6: Foreign Key Cascade Delete
  console.log('\n--- 6. Testing Foreign Key Cascade Deletion ---');
  const deleteSuccess = reminderService.deleteReminder(created.id);
  assert.strictEqual(deleteSuccess, true);

  const shouldBeNull = reminderService.getReminderById(created.id);
  assert.strictEqual(shouldBeNull, null);
  console.log('✓ Reminder and cascading child logs/reports deleted cleanly.');

  // Test 7: Express REST Endpoints (using supertest-like fetch or direct server)
  console.log('\n--- 7. Testing Express REST API Endpoints ---');
  const server = app.listen(3999, async () => {
    try {
      const baseUrl = 'http://127.0.0.1:3999/api/reminders';

      // 7.1 POST /api/reminders
      const createRes = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_name: 'API Test User',
          task_title: 'Test REST API Flow',
          task_details: 'Verify Express route integration',
          due_at: new Date(Date.now() + 7200000).toISOString()
        })
      });
      assert.strictEqual(createRes.status, 201);
      const createdApi = await createRes.json();
      assert.strictEqual(createdApi.success, true);
      const apiReminderId = createdApi.data.id;
      console.log('  ✓ POST /api/reminders -> 201 Created');

      // 7.2 GET /api/reminders
      const listRes = await fetch(baseUrl);
      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.count >= 1);
      console.log('  ✓ GET /api/reminders -> 200 OK');

      // 7.3 GET /api/reminders/:id
      const getRes = await fetch(`${baseUrl}/${apiReminderId}`);
      assert.strictEqual(getRes.status, 200);
      const singleData = await getRes.json();
      assert.strictEqual(singleData.data.task_title, 'Test REST API Flow');
      console.log('  ✓ GET /api/reminders/:id -> 200 OK');

      // 7.4 PATCH /api/reminders/:id/status
      const patchRes = await fetch(`${baseUrl}/${apiReminderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'MESSAGED',
          increment_escalation: true
        })
      });
      assert.strictEqual(patchRes.status, 200);
      const patchData = await patchRes.json();
      assert.strictEqual(patchData.data.status, 'MESSAGED');
      console.log('  ✓ PATCH /api/reminders/:id/status -> 200 OK');

      // 7.5 POST /api/reminders/:id/logs
      const logRes = await fetch(`${baseUrl}/${apiReminderId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: 'EMAIL_SENT',
          payload: { message: 'First warning sent' }
        })
      });
      assert.strictEqual(logRes.status, 201);
      console.log('  ✓ POST /api/reminders/:id/logs -> 201 Created');

      // 7.6 POST /api/reminders/:id/report
      const reportRes = await fetch(`${baseUrl}/${apiReminderId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Resolved via webhook confirmation',
          final_status: 'COMPLETED'
        })
      });
      assert.strictEqual(reportRes.status, 201);
      console.log('  ✓ POST /api/reminders/:id/report -> 201 Created');

      console.log('\n🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY! 🚀');

      server.close(() => {
        closeDatabase();
        if (fs.existsSync(testDbPath)) {
          try { fs.unlinkSync(testDbPath); } catch {}
        }
      });
    } catch (err) {
      console.error('\n❌ Test Error:', err);
      server.close(() => {
        closeDatabase();
        process.exit(1);
      });
    }
  });
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
