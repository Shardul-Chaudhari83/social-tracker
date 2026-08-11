# AI Agent Team Structure - Email to Action Tracker

This system models a multi-agent workflow that processes raw emails and generates a verified action item tracker with self-correcting QA loops.

## Agent Team Roles & Responsibilities

### 1. Extraction Agent (Main / Parent Agent)
- **Role**: Primary ingestion and extraction agent.
- **Responsibilities**:
  - Reads raw unstructured email text or multi-turn email threads.
  - Parses out candidate action items, tasks, and deliverables, even if vaguely phrased or buried in conversational text.
  - Hands candidate tasks off to the Assignment Sub-Agent.

### 2. Assignment Sub-Agent
- **Role**: Contextual owner & deadline resolver.
- **Skill Dependency**: Uses `ownership-rules` skill (`.agents/skills/ownership-rules/SKILL.md`).
- **Responsibilities**:
  - Analyzes email headers, signatures, sender/recipient contexts, and relative time expressions (e.g. "by EOD Friday", "ASAP", "next Monday").
  - Assigns a specific owner name and explicit deadline date/time to each candidate task.
  - If information is missing during initial pass or retry, applies progressive inference heuristics.

### 3. QA Sub-Agent
- **Role**: Quality assurance and verification auditor.
- **Skill Dependency**: Uses `quality-check` skill (`.agents/skills/quality-check/SKILL.md`).
- **Responsibilities**:
  - Evaluates each action item against standard quality criteria:
    1. Clear & actionable task description.
    2. Explicitly assigned owner.
    3. Defined target deadline.
  - **Self-Checking Loop**:
    - If validation **Passes**: Approves item and marks status as `Verified`.
    - If validation **Fails**: Sends item back to Assignment Sub-Agent with specific failure reason (e.g., missing deadline).
    - Retries up to **3 times max per item**.
    - If an item fails after 3 retry attempts, flags it as `Needs Human Review` rather than dropping it silently.

### 4. Report Agent
- **Role**: Aggregator and presentation compiler.
- **Responsibilities**:
  - Collects all finalized action items from QA Sub-Agent.
  - Sorts and groups action items by Owner.
  - Formats output into a clean, structured tracker table for display to stakeholders.
