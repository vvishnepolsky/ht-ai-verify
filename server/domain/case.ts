/**
 * Case data for the two subjects the workflow serves. Both are JSONB
 * aggregates on the `cases` row; `derive.ts` turns them into the required
 * verification tasks.
 */
import type { CaseKind, NpiVerification } from './types.js';

export interface Contact {
  name: string;
  phone: string | null;
  email: string | null;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface HouseholdEmployer {
  name: string;
  monthly_gross: number;
}

export interface HouseholdMember {
  name: string;
  dob: string;
  relationship: 'self' | 'spouse' | 'partner' | 'child' | 'parent' | 'other';
  employers: HouseholdEmployer[];
  /** Unearned income the member reported (SSI, child support…); descriptive only. */
  other_income?: { source: string; monthly: number }[];
}

export interface HouseholdCase {
  kind: 'household';
  case_number: string;
  programs: string[];
  applied_at: string;
  primary_contact: Contact;
  address: Address;
  members: HouseholdMember[];
  housing: {
    type: 'rent' | 'own' | 'other';
    monthly_cost: number;
    landlord?: string;
    utilities: string[];
  };
  assets: {
    declared_total: number;
    accounts: { institution: string; type: string }[];
  };
  medical: {
    has_elderly_disabled: boolean;
    monthly_expenses: number;
  };
  notes?: string;
}

export type CredentialType = 'state_license' | 'dea' | 'board_certification' | 'malpractice' | 'facility_license' | 'clia';

export interface ProviderCredential {
  type: CredentialType;
  /** Display label, e.g. "Tennessee medical license". */
  label: string;
  number: string;
  issuer: string;
  state?: string;
  issued_on?: string;
  expires_on: string;
}

export interface ProviderCase {
  kind: 'provider';
  case_number: string;
  name: string;
  /** MD, DO, NP, LCSW … (individuals only). */
  credential_suffix?: string;
  npi: string;
  entity_type: 'individual' | 'organization';
  provider_type: string;
  taxonomy_code?: string;
  specialty?: string;
  practice: { name: string; address: Address; phone: string | null };
  contact: Contact;
  enrollment: { application_type: 'new' | 'revalidation' | 'change'; submitted_at: string; medicaid_id?: string };
  credentials: ProviderCredential[];
  npi_check?: NpiVerification;
  notes?: string;
}

export type CaseData = HouseholdCase | ProviderCase;

export interface CaseRecord {
  id: string;
  kind: CaseKind;
  /** Display name — household head / provider name. */
  subject_name: string;
  data: CaseData;
  created_at: string;
  updated_at: string;
}

export function isHousehold(c: CaseData): c is HouseholdCase {
  return c.kind === 'household';
}
export function isProvider(c: CaseData): c is ProviderCase {
  return c.kind === 'provider';
}

export function displayName(c: CaseData): string {
  if (isHousehold(c)) {
    const head = c.members.find((m) => m.relationship === 'self') ?? c.members[0];
    return head?.name ?? c.primary_contact.name;
  }
  return c.credential_suffix ? `${c.name}, ${c.credential_suffix}` : c.name;
}

export function ageOn(dob: string, at = new Date()): number {
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return 0;
  let age = at.getFullYear() - b.getFullYear();
  if (at.getMonth() < b.getMonth() || (at.getMonth() === b.getMonth() && at.getDate() < b.getDate())) age -= 1;
  return age;
}

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  state_license: 'State license',
  dea: 'DEA registration',
  board_certification: 'Board certification',
  malpractice: 'Professional liability insurance',
  facility_license: 'Facility license',
  clia: 'CLIA certificate',
};
