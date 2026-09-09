// Real AI reasoning for the 4-agent pipeline (Phase 1), replacing the
// regex/keyword heuristics that used to live in server.js. Each agent is a
// single structured-output call to Claude — same roles, same retry-loop
// shape the SSE pipeline already expects (server.js still owns the loop
// control and event streaming; this module only supplies the "thinking").
//
// The Assignment and QA agents are given the project's own skill files
// (.agents/skills/*/SKILL.md) as their system prompt — the same skill
// dependency documented in agents.md, now actually driving the model
// instead of just describing intent.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const client = new Anthropic(); // resolves ANTHROPIC_API_KEY (or another supported credential) from the environment

function loadSkillFile(relativePath) {
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
  } catch (err) {
    console.error(`[AIAgent] Failed to load skill file "${relativePath}":`, err.message);
    return '';
  }
}

const OWNERSHIP_RULES_SKILL = loadSkillFile('.agents/skills/ownership-rules/SKILL.md');
const QUALITY_CHECK_SKILL = loadSkillFile('.agents/skills/quality-check/SKILL.md');

// ---------------------------------------------------------------------------
// 1. Extraction Agent
// ---------------------------------------------------------------------------

const ExtractionSchema = z.object({
  tasks: z.array(
    z.object({
      rawSnippet: z.string().describe('The exact excerpt or sentence from the email this task was derived from'),
      task: z.string().describe('A clear, concise, actionable description of the task (what needs to be done)'),
      initialOwner: z.string().nullable().describe('The person or team explicitly named as responsible in this excerpt, if stated; otherwise null'),
      initialDeadline: z.string().nullable().describe('The deadline explicitly mentioned in this excerpt, in natural language (e.g. "Friday 5:00 PM", "ASAP"), if stated; otherwise null')
    })
  )
});

/**
 * Reads raw, unstructured email text and identifies candidate action items —
 * even vaguely phrased or buried in conversational text.
 * @param {string} emailText
 * @returns {Promise<Array<{rawSnippet: string, initialTask: string, initialOwner: string|null, initialDeadline: string|null}>>}
 */
async function extractCandidateTasks(emailText) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are the Extraction Agent in a multi-agent email-to-action-tracker pipeline. Read raw, unstructured email text or multi-turn threads and identify every candidate action item, task, or deliverable mentioned — even if vaguely phrased, buried in conversational text, or only implied. Do not invent tasks that are not there. Each item should be one distinct, concrete piece of work.',
    messages: [
      { role: 'user', content: `Extract all candidate action items from this email:\n\n${emailText}` }
    ],
    output_config: { effort: 'low', format: zodOutputFormat(ExtractionSchema) }
  });

  const parsed = response.parsed_output;
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    const fallbackSnippet = emailText.slice(0, 120) + (emailText.length > 120 ? '...' : '');
    return [{
      rawSnippet: fallbackSnippet,
      initialTask: fallbackSnippet || 'Review email notification details',
      initialOwner: null,
      initialDeadline: null
    }];
  }

  return parsed.tasks.map(t => ({
    rawSnippet: t.rawSnippet,
    initialTask: t.task,
    initialOwner: t.initialOwner,
    initialDeadline: t.initialDeadline
  }));
}

// ---------------------------------------------------------------------------
// 2. Assignment Sub-Agent
// ---------------------------------------------------------------------------

const AssignmentSchema = z.object({
  owner: z.string().describe('The specific person, role, or team responsible for this task, per the ownership rules. Only use "Unassigned (Requires Lead Triage)" if truly no signal exists after applying every rule.'),
  deadline: z.string().describe('The deadline for this task as a concrete, human-readable phrase (e.g. "Friday 5:00 PM", "Within 24 Hours"), per the deadline resolution rules. Only use "TBD" as an absolute last resort.')
});

/**
 * Determines owner and deadline for one candidate task, applying the
 * ownership-rules skill and any QA retry feedback.
 * @param {Object} params
 * @param {string} params.task
 * @param {string} params.rawSnippet
 * @param {string} params.emailText - full email for context (sender, recipients, other threads)
 * @param {number} params.attempt - current attempt number (1-based)
 * @param {string|null} params.previousFeedback - QA failure reason from the prior attempt, if any
 * @returns {Promise<{owner: string, deadline: string}>}
 */
async function assignOwnerAndDeadline({ task, rawSnippet, emailText, attempt, previousFeedback }) {
  const retryContext = previousFeedback
    ? `\n\nThis is retry attempt ${attempt}. The previous attempt failed QA for this reason: "${previousFeedback}". Specifically fix that gap — do not just repeat the same answer.`
    : '';

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: `You are the Assignment Sub-Agent in a multi-agent email-to-action-tracker pipeline. Determine the owner and deadline for one candidate task using these rules:\n\n${OWNERSHIP_RULES_SKILL}`,
    messages: [
      { role: 'user', content: `Full email context:\n${emailText}\n\nCandidate task: "${task}"\nOriginal excerpt: "${rawSnippet}"${retryContext}\n\nDetermine the owner and deadline.` }
    ],
    output_config: { effort: 'low', format: zodOutputFormat(AssignmentSchema) }
  });

  return response.parsed_output || { owner: 'Unassigned (Requires Lead Triage)', deadline: 'TBD' };
}

// ---------------------------------------------------------------------------
// 3. QA Sub-Agent
// ---------------------------------------------------------------------------

const QASchema = z.object({
  passed: z.boolean().describe('true if the item satisfies all three quality criteria, false otherwise'),
  reason: z.string().nullable().describe('If passed is false, a specific, actionable reason (e.g. "Missing explicit deadline"). Null if passed is true.')
});

/**
 * Validates a candidate action item against the quality-check skill criteria.
 * @param {Object} params
 * @param {string} params.task
 * @param {string} params.owner
 * @param {string} params.deadline
 * @returns {Promise<{passed: boolean, reason: string|null}>}
 */
async function evaluateQuality({ task, owner, deadline }) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 512,
    system: `You are the QA Sub-Agent in a multi-agent email-to-action-tracker pipeline. Validate a candidate action item against these criteria:\n\n${QUALITY_CHECK_SKILL}`,
    messages: [
      { role: 'user', content: `Task: "${task}"\nOwner: "${owner}"\nDeadline: "${deadline}"\n\nDoes this item pass QA?` }
    ],
    output_config: { effort: 'low', format: zodOutputFormat(QASchema) }
  });

  return response.parsed_output || { passed: false, reason: 'QA evaluation failed to produce a result' };
}

// ---------------------------------------------------------------------------
// 4. Report Agent
// ---------------------------------------------------------------------------

const ReportSchema = z.object({
  summary: z.string().describe('A short (2-4 sentence) executive summary of the action items, highlighting owners, deadlines, and any items needing human review')
});

/**
 * Writes a short executive summary of the finalized action item tracker.
 * @param {Array<Object>} processedItems - items with {status, task, owner, deadline, flagReason}
 * @returns {Promise<string|null>}
 */
async function generateReportSummary(processedItems) {
  const itemsText = processedItems
    .map((item, i) => `${i + 1}. [${item.status}] "${item.task}" — Owner: ${item.owner || 'Unassigned'}, Deadline: ${item.deadline || 'Unspecified'}${item.flagReason ? ` (Flagged: ${item.flagReason})` : ''}`)
    .join('\n');

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: 'You are the Report Agent in a multi-agent email-to-action-tracker pipeline. Write a brief executive summary of the finalized action item tracker for stakeholders.',
    messages: [
      { role: 'user', content: `Finalized action items:\n${itemsText}\n\nWrite the executive summary.` }
    ],
    output_config: { effort: 'low', format: zodOutputFormat(ReportSchema) }
  });

  return response.parsed_output ? response.parsed_output.summary : null;
}

module.exports = {
  extractCandidateTasks,
  assignOwnerAndDeadline,
  evaluateQuality,
  generateReportSummary
};
