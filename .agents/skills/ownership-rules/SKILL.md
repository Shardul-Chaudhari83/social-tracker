---
name: ownership-rules
description: Rules and contextual heuristics for inferring task ownership and deadlines from email threads.
---

# Skill: Ownership Rules

## Purpose
Guide the Assignment Sub-Agent in determining who owns an action item and when it is due based on email context.

## Ownership Resolution Rules
1. **Direct Request**: If an email mentions "Can you take care of X, @Name?" or "Name, please update Y", assign ownership to `Name`.
2. **First-Person Commitment**: If the email author states "I will handle X" or "I'm working on Y", assign ownership to the email author/sender.
3. **Role/Function Matching**:
   - Design / Mockups / UI -> UI/UX Designer mentioned in thread.
   - Database / API / Server -> Backend/Tech Lead mentioned in thread.
   - Client / Presentation / Budget -> Project Manager / Account Manager mentioned in thread.
4. **Fallback**: If no specific person is identified, look at the primary recipient in `To:`. If still ambiguous, set owner to `Unassigned (Thread Lead)`.

## Deadline Resolution Rules
1. **Explicit Dates**: Convert explicit dates (e.g., "August 15th", "10/12") into ISO/standard date format.
2. **Relative Time Expressions**:
   - "EOD today" -> End of current date (5:00 PM).
   - "by Friday" -> Coming Friday of current week.
   - "early next week" -> Next Monday by 12:00 PM.
   - "ASAP" or "urgently" -> Within 24 hours of email timestamp.
3. **Contextual Milestones**: If mentioned alongside a meeting ("before client demo on Thursday"), set deadline 2 hours prior to meeting time.
4. **Progressive Fixes on Retry**:
   - Retry 1: Infer deadline from email header date + standard 3 business days if unstated.
   - Retry 2: Default to "End of Week (Friday 5:00 PM)".
