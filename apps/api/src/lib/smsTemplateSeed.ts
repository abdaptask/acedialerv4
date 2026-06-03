// v0.10.52 — Default tenant SMS templates.
//
// The 20-template recruiter playbook organized by category. Admin runs
// POST /admin/sms-templates/seed-defaults once after deployment to load
// these into the SmsTemplate table. Idempotent — if any template with
// the same (category, name) tuple already exists, it's skipped (admin
// edits aren't overwritten).
//
// Placeholders use {camelCase} format. At template-insert time:
//   - {firstName}  → resolved from the selected contact (if known)
//   - {recruiter}  → resolved from the signed-in user's first name
//   - everything else stays as {varName} for the recruiter to fill in
//
// Order within a category matches the order admins-curated playbook
// presented to the user, so the picker shows them in the right flow.

export interface SmsTemplateSeed {
  category: string;
  name: string;
  body: string;
  sortOrder: number;
}

export const SMS_TEMPLATE_SEEDS: SmsTemplateSeed[] = [
  // ─── Initial outreach (3) ────────────────────────────────────────────────
  {
    category: 'outreach',
    name: 'Cold outreach',
    sortOrder: 10,
    body: `Hi {firstName}, this is {recruiter} from ApTask. I came across your profile and have a {role} role with {client} that looks like a strong match for your background. Open to a quick 5-min chat this week?`,
  },
  {
    category: 'outreach',
    name: 'LinkedIn follow-up',
    sortOrder: 20,
    body: `Hi {firstName}, I sent you a LinkedIn message about a {role} opportunity at {client}. Wanted to follow up via text in case LinkedIn isn't your daily check. Are you exploring new roles right now?`,
  },
  {
    category: 'outreach',
    name: 'Referred candidate',
    sortOrder: 30,
    body: `Hi {firstName}, {referrer} mentioned you might be open to new opportunities. I'm a recruiter at ApTask working on a {role} role at {client}. Quick call to see if it's a fit?`,
  },

  // ─── Document & profile collection (2) ──────────────────────────────────
  {
    category: 'docs',
    name: 'Resume request',
    sortOrder: 10,
    body: `Hi {firstName}, could you send me your most updated resume in Word format? Also need your current work auth status so I can submit you to {client} for the {role} role.`,
  },
  {
    category: 'docs',
    name: 'Rate & availability check',
    sortOrder: 20,
    body: `Hi {firstName}, before I submit to {client}: what's your expected hourly rate, earliest start date, and current location? Need these for the submission.`,
  },

  // ─── Submission (2) ─────────────────────────────────────────────────────
  {
    category: 'submission',
    name: 'Pre-submission confirm',
    sortOrder: 10,
    body: `Hi {firstName}, confirming before I submit: {role} at {client}, {rate}/hr, {location}, start date {startDate}. Reply "yes" and I'll submit right away.`,
  },
  {
    category: 'submission',
    name: 'Just submitted',
    sortOrder: 20,
    body: `Hi {firstName}, just submitted your profile to {client} for the {role} role at {rate}/hr. Usually hear back in 24-48 hrs. Will update you the moment I hear anything.`,
  },

  // ─── Interview (4) ──────────────────────────────────────────────────────
  {
    category: 'interview',
    name: 'Interview scheduled',
    sortOrder: 10,
    body: `Hi {firstName}, good news — {client} wants to interview you for the {role} role on {date} at {time}. Are you available? I'll send the meeting link once you confirm.`,
  },
  {
    category: 'interview',
    name: 'Interview confirmation (1 hr before)',
    sortOrder: 20,
    body: `Hi {firstName}, your interview with {client} is in 1 hour. Make sure you have the meeting link, your camera/mic work, and your resume open. Good luck!`,
  },
  {
    category: 'interview',
    name: 'Reschedule needed',
    sortOrder: 30,
    body: `Hi {firstName}, {client} needs to reschedule your interview. Are you available {option1} or {option2}? Let me know which works.`,
  },
  {
    category: 'interview',
    name: 'Post-interview check-in',
    sortOrder: 40,
    body: `Hi {firstName}, how did the interview with {client} go? Any concerns or questions on your end? I'll follow up with them for feedback in a day or two.`,
  },

  // ─── Follow-ups & status (3) ────────────────────────────────────────────
  {
    category: 'followup',
    name: 'General follow-up',
    sortOrder: 10,
    body: `Hi {firstName}, just checking in. Wanted to make sure my last message didn't get buried. Are you still interested in the {role} role at {client}?`,
  },
  {
    category: 'followup',
    name: 'Update from client',
    sortOrder: 20,
    body: `Hi {firstName}, quick update — {client} is taking longer than expected to make a decision. Sticking with your timeline. Will reach out as soon as I hear anything concrete.`,
  },
  {
    category: 'followup',
    name: 'Are you still available',
    sortOrder: 30,
    body: `Hi {firstName}, are you still actively looking? Want to make sure you haven't accepted another offer before I keep going with {client}.`,
  },

  // ─── Outcomes (3) ───────────────────────────────────────────────────────
  {
    category: 'outcome',
    name: 'Offer extended',
    sortOrder: 10,
    body: `Congrats {firstName}! {client} extended an offer for the {role} role at {rate}/hr starting {startDate}. Let's hop on a quick call to walk through the details — when works for you?`,
  },
  {
    category: 'outcome',
    name: 'Rejection (kind)',
    sortOrder: 20,
    body: `Hi {firstName}, sorry to share — {client} decided to go with another candidate this time. Your profile was strong; this just wasn't the right match. I'll keep looking for other roles that fit. Stay in touch.`,
  },
  {
    category: 'outcome',
    name: 'Rate negotiation',
    sortOrder: 30,
    body: `Hi {firstName}, {client} came back at {clientRate}/hr instead of {askedRate}. Is that workable for you or should I push back?`,
  },

  // ─── Onboarding & BGV (2) ───────────────────────────────────────────────
  {
    category: 'bgv',
    name: 'BGV docs request',
    sortOrder: 10,
    body: `Hi {firstName}, congrats on the offer! For BGV I'll need: PAN, Aadhaar (or I-9 docs if in US), highest education certificate, last 2 paystubs, and 2 professional references. Can you send these by {dueDate}?`,
  },
  {
    category: 'bgv',
    name: 'Day-1 check-in',
    sortOrder: 20,
    body: `Hi {firstName}, welcome to your first day at {client}! How's everything going? Reach out anytime — payroll questions, manager intros, or anything else.`,
  },

  // ─── Relationship maintenance (1) ───────────────────────────────────────
  {
    category: 'relationship',
    name: 'Quarterly touch base',
    sortOrder: 10,
    body: `Hi {firstName}, hope you're doing well! Quick check-in — are you happy at {currentCompany} or open to exploring? Have a few new {role} roles that might interest you.`,
  },
];

// Display-friendly category labels for the picker.
export const SMS_TEMPLATE_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'outreach', label: 'Initial outreach' },
  { key: 'docs', label: 'Documents & profile' },
  { key: 'submission', label: 'Submission' },
  { key: 'interview', label: 'Interview' },
  { key: 'followup', label: 'Follow-ups & status' },
  { key: 'outcome', label: 'Outcomes' },
  { key: 'bgv', label: 'Onboarding & BGV' },
  { key: 'relationship', label: 'Relationship maintenance' },
  { key: 'custom', label: 'Custom' },
];
