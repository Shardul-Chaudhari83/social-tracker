// Converts the free-text deadline labels produced by the (currently
// heuristic) Assignment Sub-Agent — e.g. "Friday 5:00 PM", "Tomorrow 5:00 PM",
// "Within 24 Hours (Urgent SLA)" — into a concrete Date the reminders system
// can schedule against. This is intentionally simple pattern-matching, same
// spirit as the rest of the current pipeline; Phase 1 (real AI reasoning)
// can later replace it with an LLM that emits a due_at directly.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEFAULT_FALLBACK_HOURS = 24;

function extractTimeOfDay(label) {
  const match = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  return { hours, minutes };
}

function setTimeOfDay(date, hours, minutes) {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function nextWeekday(fromDate, targetDayIndex) {
  const result = new Date(fromDate);
  const currentDayIndex = result.getDay();
  let diff = (targetDayIndex - currentDayIndex + 7) % 7;
  if (diff === 0) diff = 7; // "Friday" always means the upcoming one, not today
  result.setDate(result.getDate() + diff);
  return result;
}

function addBusinessDays(fromDate, count) {
  const result = new Date(fromDate);
  let added = 0;
  while (added < count) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

/**
 * Resolves a free-text deadline label to a concrete Date.
 * Always returns a valid, future-leaning Date — never null — since
 * reminders.due_at is required.
 * @param {string|null} deadlineLabel
 * @param {Date} [now] - injectable for testing
 * @returns {Date}
 */
function resolveDueDate(deadlineLabel, now = new Date()) {
  if (!deadlineLabel || typeof deadlineLabel !== 'string') {
    return new Date(now.getTime() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000);
  }

  const label = deadlineLabel.toLowerCase();
  const explicitTime = extractTimeOfDay(deadlineLabel);
  const defaultTime = { hours: 17, minutes: 0 }; // 5:00 PM default when no time is given
  const time = explicitTime || defaultTime;

  if (label.includes('tonight')) {
    return setTimeOfDay(now, 23, 59);
  }

  if (label.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return setTimeOfDay(tomorrow, time.hours, time.minutes);
  }

  if (label.includes('within 24 hours')) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  if (label.includes('business day')) {
    const businessDaysMatch = label.match(/within\s+(\d+)\s+business\s+days?/);
    const days = businessDaysMatch ? parseInt(businessDaysMatch[1], 10) : 3;
    return setTimeOfDay(addBusinessDays(now, days), time.hours, time.minutes);
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (label.includes(WEEKDAYS[i])) {
      return setTimeOfDay(nextWeekday(now, i), time.hours, time.minutes);
    }
  }

  // Unrecognized label — safe fallback rather than leaving due_at unset
  return new Date(now.getTime() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000);
}

module.exports = { resolveDueDate };
