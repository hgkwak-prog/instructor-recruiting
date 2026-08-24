/**
 * Operating conditions are the operator's own declaration, so they are
 * authoritative. The model reads them in the prompt and usually copies them
 * correctly, but "usually" is not a contract: a field the operator declared
 * must never end up empty because the model overlooked it.
 *
 * This fills any fact the model left null from the matching condition, before
 * verification. A value the model *did* fill is left alone -- verify.mjs
 * compares those and errors on a mismatch rather than silently overwriting.
 */

import { normalizeRole, normalizeDisclosure } from './verify.mjs';

/** condition key -> fact key. Only operational facts; never course content. */
export const CONDITION_TO_FACT = {
  instructorRole: 'role',
  customerDisclosure: 'customerDisclosure',
  customerLabel: 'customerLabel',
  location: 'location',
  headcount: 'headcount',
  dailySchedule: 'dailySchedule',
  workingHours: 'workingHours',
  travelExpenseIncluded: 'travelExpenseIncluded',
  applicationMethod: 'applicationMethod',
  deadline: 'deadline',
  deadlineTime: 'deadlineTime'
};

const NORMALIZERS = {
  role: normalizeRole,
  customerDisclosure: normalizeDisclosure
};

/**
 * Returns a new facts object plus the fact keys that were filled, so the CLI
 * and the review report can say which values came from the operator rather
 * than from the document.
 */
export function applyConditions(facts, conditions = {}) {
  const filled = [];
  const next = { ...facts };

  for (const [conditionKey, factKey] of Object.entries(CONDITION_TO_FACT)) {
    const raw = conditions[conditionKey];
    if (raw === undefined || raw === null) continue;

    const current = next[factKey];
    const isEmpty = !current
      || current.value === null
      || (Array.isArray(current.value) && current.value.length === 0);
    if (!isEmpty) continue;

    const normalize = NORMALIZERS[factKey];
    next[factKey] = {
      value: normalize ? normalize(raw) : raw,
      evidence: `운영 조건 ${conditionKey}: ${raw}`
    };
    filled.push(factKey);
  }

  return { facts: next, filled };
}
