---
name: quality-check
description: Pass/fail criteria for verifying candidate action items before final report compilation.
---

# Skill: Quality Check

## Purpose
Guide the QA Sub-Agent in validating candidate action items for complete metadata and clarity.

## Validation Criteria
An action item **PASSES** QA if and only if ALL three conditions below are satisfied:

1. **Clear Task Description**:
   - Must be concrete and actionable (e.g., "Prepare Q3 deck", NOT "stuff").
   - Minimum 5 words describing what needs to be done.

2. **Named Owner**:
   - Must be assigned to a specific individual or explicit role.
   - Must NOT be "Unassigned", "Unknown", or empty.

3. **Explicit Deadline**:
   - Must have a specific date/time or target deadline phrase.
   - Must NOT be empty or "TBD".

## Fail & Retry Handling
- If any criterion fails:
  1. Record reason for failure (e.g. `Missing deadline`, `Unassigned owner`, `Vague task`).
  2. Increment attempt counter for the item.
  3. If attempt count <= 3: Return item to Assignment Sub-Agent with specific feedback to retry assignment.
  4. If attempt count > 3: Flag item with status `Needs Human Review` and attach reason, preventing silent loss.
