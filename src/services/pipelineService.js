// The core Extraction -> Assignment -> QA (retry up to 3x) -> Report Agent
// pipeline, extracted out of server.js's SSE route so it has exactly one
// implementation shared by every entry point — the web UI
// (POST /api/process-email) and the file-based CLI tool
// (scripts/send_from_file.js). Both get identical agent behavior; only how
// progress is surfaced (SSE events vs console output) and what happens
// after (defer to the scheduler vs send immediately) differs per caller.

const aiAgentService = require('./aiAgentService');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs the full agent pipeline over raw email text.
 * @param {string} emailText
 * @param {Object} [options]
 * @param {(event: Object) => void} [options.onEvent] - called with the same
 *   event shape server.js used to pass straight into sendEvent('status', ...)
 * @param {boolean} [options.withDelays] - insert the small pacing delays the
 *   web UI's live log relies on for a readable animation. The CLI tool
 *   doesn't want these — it should run as fast as the underlying calls allow.
 * @returns {Promise<{processedItems: Array, groupedItems: Object, aiSummary: string|null}>}
 */
async function runAgentPipeline(emailText, { onEvent, withDelays = false } = {}) {
  const emit = onEvent || (() => {});
  const pace = withDelays ? delay : () => Promise.resolve();

  emit({ agent: 'System', message: 'Workflow initiated: Email to Action Tracker' });
  await pace(400);

  emit({
    agent: 'Extraction Agent',
    type: 'agent-start',
    message: 'Reading raw email text and extracting task candidates...'
  });
  await pace(800);

  const extractedCandidates = await aiAgentService.extractCandidateTasks(emailText);

  emit({
    agent: 'Extraction Agent',
    type: 'agent-complete',
    message: `Extracted ${extractedCandidates.length} candidate tasks from email thread.`,
    candidates: extractedCandidates
  });
  await pace(600);

  const processedItems = [];

  for (let i = 0; i < extractedCandidates.length; i++) {
    const candidate = extractedCandidates[i];
    const itemNum = i + 1;

    emit({
      agent: 'Extraction Agent',
      type: 'item-start',
      message: `Processing Task #${itemNum}: "${candidate.rawSnippet}"`
    });
    await pace(500);

    let currentItem = {
      id: itemNum,
      rawSnippet: candidate.rawSnippet,
      task: candidate.initialTask,
      owner: candidate.initialOwner,
      deadline: candidate.initialDeadline,
      attempts: 0,
      status: 'Pending',
      logs: []
    };

    let passedQA = false;
    const maxRetries = 3;
    let lastQaReason = null;

    while (!passedQA && currentItem.attempts <= maxRetries) {
      currentItem.attempts++;
      const attemptLabel = `Attempt ${currentItem.attempts}/${maxRetries}`;

      emit({
        agent: 'Assignment Sub-Agent',
        type: 'assignment-work',
        itemId: itemNum,
        attempt: currentItem.attempts,
        message: `[${attemptLabel}] Applying 'ownership-rules' skill to infer owner & deadline for Task #${itemNum}...`
      });

      const assignment = await aiAgentService.assignOwnerAndDeadline({
        task: currentItem.task,
        rawSnippet: currentItem.rawSnippet,
        emailText,
        attempt: currentItem.attempts,
        previousFeedback: lastQaReason
      });
      currentItem = { ...currentItem, owner: assignment.owner, deadline: assignment.deadline };

      emit({
        agent: 'Assignment Sub-Agent',
        type: 'assignment-done',
        itemId: itemNum,
        attempt: currentItem.attempts,
        message: `[${attemptLabel}] Task #${itemNum} assigned -> Owner: "${currentItem.owner}", Deadline: "${currentItem.deadline}"`,
        itemState: currentItem
      });

      emit({
        agent: 'QA Sub-Agent',
        type: 'qa-check',
        itemId: itemNum,
        attempt: currentItem.attempts,
        message: `[${attemptLabel}] Reviewing Task #${itemNum} against 'quality-check' skill criteria...`
      });

      const qaResult = await aiAgentService.evaluateQuality({
        task: currentItem.task,
        owner: currentItem.owner,
        deadline: currentItem.deadline
      });
      lastQaReason = qaResult.reason;

      if (qaResult.passed) {
        passedQA = true;
        currentItem.status = 'Verified';
        emit({
          agent: 'QA Sub-Agent',
          type: 'qa-pass',
          itemId: itemNum,
          attempt: currentItem.attempts,
          message: `✓ Task #${itemNum} PASSED QA on attempt ${currentItem.attempts}! Criteria satisfied (Clear task, named owner, explicit deadline).`,
          itemState: currentItem
        });
        await pace(600);
      } else if (currentItem.attempts < maxRetries) {
        emit({
          agent: 'QA Sub-Agent',
          type: 'qa-retry',
          itemId: itemNum,
          attempt: currentItem.attempts,
          maxRetries,
          reason: qaResult.reason,
          message: `⚠️ Item ${itemNum} failed QA (${qaResult.reason}) → retrying (${currentItem.attempts}/${maxRetries}). Sending back to Assignment Sub-Agent.`
        });
        await pace(900);
      } else {
        currentItem.status = 'Needs Human Review';
        currentItem.flagReason = qaResult.reason;
        emit({
          agent: 'QA Sub-Agent',
          type: 'qa-flagged',
          itemId: itemNum,
          attempt: currentItem.attempts,
          maxRetries,
          reason: qaResult.reason,
          message: `🚨 Item ${itemNum} failed QA after ${maxRetries} retries (${qaResult.reason}) → Flagged for Human Review.`
        });
        await pace(800);
        break;
      }
    }

    processedItems.push(currentItem);
  }

  emit({
    agent: 'Report Agent',
    type: 'report-building',
    message: 'Compiling finalized action items and grouping by owner...'
  });
  await pace(800);

  const groupedItems = {};
  processedItems.forEach(item => {
    const ownerKey = item.owner || 'Unassigned';
    if (!groupedItems[ownerKey]) groupedItems[ownerKey] = [];
    groupedItems[ownerKey].push(item);
  });

  emit({
    agent: 'Report Agent',
    type: 'summary-generating',
    message: 'Writing executive summary of the finalized tracker...'
  });

  let aiSummary = null;
  try {
    aiSummary = await aiAgentService.generateReportSummary(processedItems);
  } catch (err) {
    console.error('Failed to generate AI report summary:', err.message);
  }

  return { processedItems, groupedItems, aiSummary };
}

module.exports = { runAgentPipeline };
