/**
 * Derive the required verification tasks from case data — the generalized
 * sibling of ht-cre's `checklist/deriveTasks.ts`. Pure; no I/O.
 *
 * Household: per adult a photo ID (upload or CLEAR); per earner pay stubs
 * (upload or Argyle payroll); a bank statement when assets are declared
 * (upload or Argyle bank/VOA); the lease or mortgage statement; a utility
 * bill when the household pays utilities; medical bills when an elderly or
 * disabled member reported them.
 *
 * Provider: the automatic NPI Registry check; a photo ID for the individual
 * (upload or CLEAR); one task per credential on file — state licenses and
 * DEA registrations are `license`, board certifications `credential`,
 * liability insurance `insurance`. Every task carries the declared facts the
 * AI review cross-checks the document against (license number, expiration,
 * licensee name, employer, rent …).
 */
import { ageOn, CREDENTIAL_TYPE_LABELS, isHousehold, type CaseData, type HouseholdCase, type ProviderCase } from './case.js';
import { CATEGORY_ORDER, type DeclaredFact, type TaskCategory, type TaskMethod, type VerificationTask } from './types.js';

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month`;
}

function longDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

interface Draft {
  category: TaskCategory;
  key: string;
  subject?: string;
  title: string;
  reason: string;
  required?: boolean;
  methods: TaskMethod[];
  declared?: DeclaredFact[];
  expected_employers?: string[];
}

function materialize(drafts: Draft[], now: string): VerificationTask[] {
  const seen = new Map<string, number>();
  return drafts
    .map((d) => {
      const base = `${d.category}:${d.key}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      const task: VerificationTask = {
        id,
        category: d.category,
        ...(d.subject ? { subject: d.subject } : {}),
        title: d.title,
        reason: d.reason,
        required: d.required ?? true,
        methods: d.methods,
        method: d.methods[0] ?? 'upload',
        status: 'needed',
        ...(d.declared && d.declared.length > 0 ? { declared: d.declared } : {}),
        ...(d.expected_employers ? { expected_employers: d.expected_employers } : {}),
        files: [],
        updated_at: now,
      };
      return task;
    })
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

export function deriveHouseholdTasks(c: HouseholdCase, now = new Date().toISOString()): VerificationTask[] {
  const drafts: Draft[] = [];
  const address = `${c.address.street}, ${c.address.city}, ${c.address.state} ${c.address.zip}`;
  const programs = c.programs.join(' / ');

  for (const m of c.members) {
    const adult = ageOn(m.dob) >= 18 || m.relationship === 'self' || m.relationship === 'spouse' || m.relationship === 'partner';
    if (adult) {
      drafts.push({
        category: 'identity',
        key: 'photo-id',
        subject: m.name,
        title: `Government-issued photo ID for ${m.name}`,
        reason: `Each adult in the household must prove identity for the ${programs} application.`,
        methods: ['upload', 'clear'],
        declared: [
          { label: 'Name', value: m.name },
          { label: 'Date of birth', value: longDate(m.dob) },
        ],
      });
    }
    for (const e of m.employers) {
      drafts.push({
        category: 'income',
        key: 'pay-stubs',
        subject: m.name,
        title: `${firstName(m.name)}'s pay stubs for the last 30 days (${e.name})`,
        reason: `${m.name} reported ${money(e.monthly_gross)} gross from ${e.name}. Recent pay stubs confirm the amount and the employer.`,
        methods: ['upload', 'argyle'],
        expected_employers: [e.name],
        declared: [
          { label: 'Employee name', value: m.name },
          { label: 'Employer', value: e.name },
          {
            label: 'Gross income (approximate monthly figure)',
            value: `${money(e.monthly_gross)} — a pay stub may be weekly or biweekly; compare the monthly equivalent`,
          },
        ],
      });
    }
  }

  if (c.assets.declared_total > 0 || c.assets.accounts.length > 0) {
    const head = c.members.find((m) => m.relationship === 'self') ?? c.members[0];
    drafts.push({
      category: 'assets',
      key: 'bank-statements',
      subject: head?.name,
      title: 'Bank statements for the last 60 days',
      reason: `The household reported ${money(c.assets.declared_total).replace('/month', '')} in ${c.assets.accounts.length || 'its'} account${c.assets.accounts.length === 1 ? '' : 's'}. Statements confirm countable resources.`,
      methods: ['upload', 'argyle'],
      declared: [
        { label: 'Account holder', value: head?.name ?? c.primary_contact.name },
        ...c.assets.accounts.map((a) => ({ label: 'Institution', value: `${a.institution} (${a.type})` })),
        { label: 'Reported balance (approximate)', value: `about $${c.assets.declared_total.toLocaleString('en-US')} at the time of application` },
      ],
    });
  }

  if (c.housing.type === 'rent') {
    drafts.push({
      category: 'residency_housing',
      key: 'lease-or-landlord-statement',
      title: 'Lease agreement or landlord statement',
      reason: `The household reported rent of ${money(c.housing.monthly_cost)}${c.housing.landlord ? ` to ${c.housing.landlord}` : ''}. The lease confirms the shelter expense and the address.`,
      methods: ['upload'],
      declared: [
        { label: 'Monthly rent (exact amount on the lease)', value: money(c.housing.monthly_cost) },
        { label: 'Address', value: address },
        ...(c.housing.landlord ? [{ label: 'Landlord', value: c.housing.landlord }] : []),
        { label: 'Tenant', value: c.members.find((m) => m.relationship === 'self')?.name ?? c.primary_contact.name },
      ],
    });
  } else if (c.housing.type === 'own') {
    drafts.push({
      category: 'residency_housing',
      key: 'mortgage-statement',
      title: 'Most recent mortgage statement',
      reason: `The household reported a mortgage payment of ${money(c.housing.monthly_cost)}. The statement confirms the shelter expense and the address.`,
      methods: ['upload'],
      declared: [
        { label: 'Monthly payment (approximate)', value: money(c.housing.monthly_cost) },
        { label: 'Property address', value: address },
      ],
    });
  }

  if (c.housing.utilities.length > 0) {
    drafts.push({
      category: 'expenses_deductions',
      key: 'utility-bill',
      title: 'Most recent utility bill',
      reason: `The household pays ${c.housing.utilities.join(' and ')}. A current bill in a household member's name at the address supports the utility allowance.`,
      methods: ['upload'],
      required: false,
      declared: [{ label: 'Service address', value: address }],
    });
  }

  if (c.medical.has_elderly_disabled && c.medical.monthly_expenses > 0) {
    drafts.push({
      category: 'medical_bills',
      key: 'medical-expenses',
      title: 'Medical bills or receipts',
      reason: `An elderly or disabled member reported ${money(c.medical.monthly_expenses)} in out-of-pocket medical costs, which can be deducted.`,
      methods: ['upload'],
      declared: [{ label: 'Reported monthly medical expenses (approximate)', value: money(c.medical.monthly_expenses) }],
    });
  }

  return materialize(drafts, now);
}

export function deriveProviderTasks(c: ProviderCase, now = new Date().toISOString()): VerificationTask[] {
  const drafts: Draft[] = [];
  const name = c.credential_suffix ? `${c.name}, ${c.credential_suffix}` : c.name;

  drafts.push({
    category: 'npi',
    key: 'nppes',
    subject: name,
    title: `NPI ${c.npi} — National Plan & Provider Enumeration System check`,
    reason: 'The NPI on the application is checked against the CMS NPI Registry for an active record whose name and taxonomy match.',
    methods: ['nppes'],
    declared: [
      { label: 'Name', value: name },
      { label: 'Provider type', value: c.provider_type },
      { label: 'Entity type', value: c.entity_type },
    ],
  });

  if (c.entity_type === 'individual') {
    drafts.push({
      category: 'identity',
      key: 'photo-id',
      subject: name,
      title: `Government-issued photo ID for ${name}`,
      reason: 'Medicaid enrollment screening requires proof of identity for the individual provider (42 CFR 455.412).',
      methods: ['upload', 'clear'],
      declared: [{ label: 'Name', value: c.name }],
    });
  }

  for (const cred of c.credentials) {
    const category: TaskCategory =
      cred.type === 'board_certification' ? 'credential' : cred.type === 'malpractice' ? 'insurance' : 'license';
    const typeLabel = CREDENTIAL_TYPE_LABELS[cred.type];
    const declared: DeclaredFact[] = [
      { label: cred.type === 'malpractice' ? 'Insured' : 'Licensee / certificate holder', value: name },
      { label: cred.type === 'malpractice' ? 'Policy number' : `${typeLabel} number`, value: cred.number },
      { label: 'Issuer', value: cred.issuer },
      ...(cred.state ? [{ label: 'State', value: cred.state }] : []),
      { label: 'Expiration date', value: longDate(cred.expires_on) },
    ];
    const reason =
      cred.type === 'state_license'
        ? `The application lists ${cred.label} #${cred.number}, expiring ${longDate(cred.expires_on)}. A current license must be on file before enrollment (42 CFR 455.412).`
        : cred.type === 'dea'
          ? `The application lists DEA registration ${cred.number}, expiring ${longDate(cred.expires_on)}. Required to prescribe controlled substances to members.`
          : cred.type === 'board_certification'
            ? `The application lists ${cred.label} (${cred.issuer}), valid through ${longDate(cred.expires_on)}.`
            : cred.type === 'malpractice'
              ? `The application lists policy ${cred.number} with ${cred.issuer}, in force through ${longDate(cred.expires_on)}. A current certificate of insurance is required.`
              : `The application lists ${cred.label} #${cred.number}, expiring ${longDate(cred.expires_on)}.`;
    drafts.push({
      category,
      key: slug(cred.label),
      subject: name,
      title: `${cred.label} — ${cred.type === 'malpractice' ? 'certificate of insurance' : 'current copy'}`,
      reason,
      methods: ['upload'],
      declared,
    });
  }

  return materialize(drafts, now);
}

export function deriveTasks(c: CaseData, now = new Date().toISOString()): VerificationTask[] {
  return isHousehold(c) ? deriveHouseholdTasks(c, now) : deriveProviderTasks(c, now);
}
