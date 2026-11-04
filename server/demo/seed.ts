/**
 * Synthetic demo data — two benefit households and three Medicaid providers.
 * Every name, address, number and NPI here is fabricated (the NPIs carry a
 * valid check digit but are not assigned in NPPES, so the automatic registry
 * check reports "not found" for them — which is itself a demo of that flag).
 * The console's "Add provider by NPI" path is where a real registry record
 * comes in.
 */
import { store } from '../db.js';
import type { HouseholdCase, ProviderCase } from '../domain/case.js';
import { displayName } from '../domain/case.js';

/** Append the NPPES check digit (Luhn over 80840 + 9 digits). */
function npiWithCheckDigit(nine: string): string {
  const digits = ('80840' + nine).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = true; i >= 0; i--, alt = !alt) {
    let d = digits[i] as number;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return nine + String((10 - (sum % 10)) % 10);
}

export const DEMO_NPIS = {
  vasquez: npiWithCheckDigit('199940017'),
  bell: npiWithCheckDigit('199940028'),
  harmony: npiWithCheckDigit('199940039'),
};

export const DEMO_HOUSEHOLDS: HouseholdCase[] = [
  {
    kind: 'household',
    case_number: 'HH-2026-00418',
    programs: ['SNAP', 'Medicaid'],
    applied_at: '2026-10-28',
    primary_contact: { name: 'Jordan Reyes', phone: '(615) 555-0142', email: 'jordan.reyes@example.com' },
    address: { street: '1427 Riverbend Ave, Apt 3B', city: 'Nashville', state: 'TN', zip: '37206' },
    members: [
      { name: 'Jordan Reyes', dob: '1989-03-14', relationship: 'self', employers: [{ name: 'Walmart', monthly_gross: 1100 }] },
      { name: 'Casey Reyes', dob: '1991-07-02', relationship: 'spouse', employers: [{ name: 'Kroger', monthly_gross: 450 }] },
      { name: 'Mia Reyes', dob: '2018-11-20', relationship: 'child', employers: [] },
    ],
    housing: { type: 'rent', monthly_cost: 950, landlord: 'Riverbend Property Management', utilities: ['electricity', 'natural gas'] },
    assets: { declared_total: 420, accounts: [{ institution: 'First Cumberland Bank', type: 'checking' }] },
    medical: { has_elderly_disabled: false, monthly_expenses: 0 },
    notes: 'Applied online. Interview completed 10/30. Household of 3 with two earners.',
  },
  {
    kind: 'household',
    case_number: 'HH-2026-00431',
    programs: ['Medicaid'],
    applied_at: '2026-10-30',
    primary_contact: { name: 'Dana Okafor', phone: '(901) 555-0188', email: 'dana.okafor@example.com' },
    address: { street: '88 Magnolia Court', city: 'Memphis', state: 'TN', zip: '38104' },
    members: [
      { name: 'Dana Okafor', dob: '1975-01-09', relationship: 'self', employers: [{ name: 'Riverside Senior Care LLC', monthly_gross: 1900 }] },
      { name: 'Ngozi Okafor', dob: '1952-05-30', relationship: 'parent', employers: [], other_income: [{ source: 'Social Security retirement', monthly: 1210 }] },
    ],
    housing: { type: 'own', monthly_cost: 740, utilities: ['electricity', 'water'] },
    assets: { declared_total: 2650, accounts: [{ institution: 'Memphis Community Credit Union', type: 'savings' }] },
    medical: { has_elderly_disabled: true, monthly_expenses: 185 },
    notes: 'Elderly parent in the household with recurring prescription costs.',
  },
];

export const DEMO_PROVIDERS: ProviderCase[] = [
  {
    kind: 'provider',
    case_number: 'PRV-2026-00077',
    name: 'Elena Vasquez',
    credential_suffix: 'MD',
    npi: DEMO_NPIS.vasquez,
    entity_type: 'individual',
    provider_type: 'Physician — Internal Medicine',
    taxonomy_code: '207R00000X',
    specialty: 'Internal Medicine',
    practice: {
      name: 'Cumberland Internal Medicine Group',
      address: { street: '2200 Church Street, Suite 410', city: 'Nashville', state: 'TN', zip: '37203' },
      phone: '(615) 555-0170',
    },
    contact: { name: 'Elena Vasquez', phone: '(615) 555-0171', email: 'elena.vasquez@example.com' },
    enrollment: { application_type: 'revalidation', submitted_at: '2026-10-27', medicaid_id: 'TN-MCD-4471920' },
    credentials: [
      { type: 'state_license', label: 'Tennessee medical license', number: 'MD-48213', issuer: 'Tennessee Board of Medical Examiners', state: 'TN', issued_on: '2017-07-01', expires_on: '2027-06-30' },
      { type: 'dea', label: 'DEA registration', number: 'BV4821367', issuer: 'U.S. Drug Enforcement Administration', expires_on: '2027-03-31' },
      { type: 'board_certification', label: 'ABIM board certification — Internal Medicine', number: '318842', issuer: 'American Board of Internal Medicine', expires_on: '2030-12-31' },
      { type: 'malpractice', label: 'Professional liability insurance', number: 'PL-7730415', issuer: 'MedPro Mutual Assurance', expires_on: '2027-01-31' },
    ],
    notes: 'Revalidation cycle. Previously enrolled 2021.',
  },
  {
    kind: 'provider',
    case_number: 'PRV-2026-00081',
    name: 'Marcus Bell',
    credential_suffix: 'LCSW',
    npi: DEMO_NPIS.bell,
    entity_type: 'individual',
    provider_type: 'Behavioral health — Clinical Social Worker',
    taxonomy_code: '1041C0700X',
    specialty: 'Clinical Social Work',
    practice: {
      name: 'Eastside Counseling Collective',
      address: { street: '512 Gallatin Pike S', city: 'Madison', state: 'TN', zip: '37115' },
      phone: '(615) 555-0193',
    },
    contact: { name: 'Marcus Bell', phone: '(615) 555-0194', email: 'marcus.bell@example.com' },
    enrollment: { application_type: 'new', submitted_at: '2026-11-01' },
    credentials: [
      { type: 'state_license', label: 'Tennessee LCSW license', number: 'LCSW-11942', issuer: 'Tennessee Board of Social Worker Licensure', state: 'TN', issued_on: '2020-02-15', expires_on: '2027-02-28' },
      { type: 'malpractice', label: 'Professional liability insurance', number: 'BH-2290031', issuer: 'CPH & Associates', expires_on: '2027-05-15' },
    ],
    notes: 'New enrollment. Telehealth and in-person.',
  },
  {
    kind: 'provider',
    case_number: 'PRV-2026-00084',
    name: 'Harmony Family Health Center',
    npi: DEMO_NPIS.harmony,
    entity_type: 'organization',
    provider_type: 'Federally Qualified Health Center',
    taxonomy_code: '261QF0400X',
    practice: {
      name: 'Harmony Family Health Center',
      address: { street: '940 Jefferson Street', city: 'Nashville', state: 'TN', zip: '37208' },
      phone: '(615) 555-0150',
    },
    contact: { name: 'Priya Natarajan (Credentialing Coordinator)', phone: '(615) 555-0151', email: 'credentialing@harmonyfhc.example.com' },
    enrollment: { application_type: 'change', submitted_at: '2026-10-22', medicaid_id: 'TN-MCD-2208817' },
    credentials: [
      { type: 'facility_license', label: 'Tennessee ambulatory care facility license', number: 'ASC-0427', issuer: 'Tennessee Department of Health', state: 'TN', expires_on: '2027-09-30' },
      { type: 'clia', label: 'CLIA certificate of waiver', number: '44D2187733', issuer: 'CMS / Tennessee Department of Health', expires_on: '2028-03-14' },
      { type: 'malpractice', label: 'General & professional liability insurance', number: 'GL-5510284', issuer: 'Coverys', expires_on: '2027-04-30' },
    ],
    notes: 'Change of ownership filing; existing enrollment.',
  },
];

export async function seedDemoData(): Promise<number> {
  let n = 0;
  for (const h of DEMO_HOUSEHOLDS) {
    await store.createCase('household', displayName(h), h);
    n++;
  }
  for (const p of DEMO_PROVIDERS) {
    await store.createCase('provider', displayName(p), p);
    n++;
  }
  return n;
}
