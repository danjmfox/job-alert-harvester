// PURE. Fit against the CV profile: Senior Agile Coach, 25+ years.
// DERIVED ONLY — a score never removes a row from the workbook. Re-scoreable
// at any time by re-running the harvest.

const ROLE_MATCHES = [
  { pattern: /agile coach/i, points: 4, label: 'agile coach' },
  { pattern: /business agility/i, points: 4, label: 'business agility' },
  { pattern: /scrum master/i, points: 3, label: 'scrum master' },
  { pattern: /delivery (manager|lead)/i, points: 2, label: 'delivery manager/lead' },
  { pattern: /engineering manager/i, points: 2, label: 'engineering manager' },
  { pattern: /product manager/i, points: 1, label: 'product manager' },
];

const SENIORITY = /\b(senior|snr|lead|head|principal|enterprise)\b/i;

const MISFITS = [
  /internship/i,
  /\bjunior\b/i,
  /mechanical/i,
  /construction/i,
  /accountant/i,
  /journalist/i,
];

export function scoreFit(title) {
  const text = title ?? '';
  const reasons = [];
  let score = 0;

  for (const { pattern, points, label } of ROLE_MATCHES) {
    if (!pattern.test(text)) continue;
    score += points;
    reasons.push(label);
  }

  if (SENIORITY.test(text)) {
    score += 1;
    reasons.push('seniority');
  }

  const misfits = MISFITS.filter((pattern) => pattern.test(text));
  score -= misfits.length * 3;
  if (misfits.length) reasons.push('off-profile');

  return {
    score,
    reason: reasons.length ? reasons.join(', ') : 'no profile keywords matched',
  };
}
