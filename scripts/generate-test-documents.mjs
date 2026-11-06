/**
 * Generate the synthetic pass/fail test documents under docs/test-documents/.
 *
 *   node scripts/generate-test-documents.mjs      # writes *.html + index.json
 *   bash scripts/render-test-documents.sh          # renders PDF + PNG with headless Chrome
 *
 * Every document is FABRICATED for the two demo cases seeded by
 * server/demo/seed.ts (the Jordan Reyes household, HH-2026-00418, and
 * Elena Vasquez MD, PRV-2026-00077). Each pass/fail pair keeps everything
 * identical except the one thing the AI first-pass review should catch:
 * an expired term, a lapsed date, a different name, a different employer,
 * a different license number, or the wrong kind of document.
 *
 * Dates: "current" documents are pinned to a fixed window around the demo
 * date (Nov 2026). Once that passes, bump the constants and regenerate.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/test-documents');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #000; font-family: 'Times New Roman', Times, Georgia, serif; font-size: 16px; line-height: 1.5; }
.page { width: 816px; min-height: 1056px; margin: 0 auto; padding: 56px 64px; }
header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 12px; margin-bottom: 22px; }
.org { font-family: Arial, Helvetica, sans-serif; font-size: 14px; letter-spacing: 0.14em; text-transform: uppercase; }
h1 { font-size: 28px; margin: 8px 0 4px; }
.sub { font-family: Arial, Helvetica, sans-serif; font-size: 14px; }
.box { border: 3px solid #000; padding: 14px 18px; margin: 20px 0; text-align: center; }
.box .lbl { font-family: Arial, Helvetica, sans-serif; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; }
.box .big { font-size: 26px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; margin: 14px 0; }
th, td { border: 1px solid #000; padding: 8px 10px; text-align: left; vertical-align: top; font-size: 15px; }
th { background: #eee; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
.right { text-align: right; }
.sig { display: flex; justify-content: space-between; margin-top: 40px; gap: 40px; }
.sig div { flex: 1; border-top: 1px solid #000; padding-top: 6px; font-size: 13px; font-family: Arial, Helvetica, sans-serif; }
.fine { font-size: 12px; color: #333; margin-top: 24px; font-family: Arial, Helvetica, sans-serif; }
.stamp { display: inline-block; border: 3px double #000; padding: 6px 14px; font-family: Arial, Helvetica, sans-serif; font-weight: bold; letter-spacing: 0.1em; margin-top: 12px; }
.card { width: 680px; height: 430px; margin: 60px auto; border: 2px solid #222; border-radius: 22px; background: linear-gradient(135deg, #f6f3ea 0%, #e9f0f6 100%); padding: 26px 30px; font-family: Arial, Helvetica, sans-serif; position: relative; }
.card .state { font-size: 22px; font-weight: bold; letter-spacing: 0.08em; }
.card .kind { font-size: 15px; letter-spacing: 0.2em; text-transform: uppercase; color: #333; }
.card .photo { position: absolute; left: 30px; top: 110px; width: 170px; height: 220px; border: 2px solid #555; background: #d9d3c5; display: flex; align-items: center; justify-content: center; color: #555; font-size: 13px; text-align: center; }
.card .fields { position: absolute; left: 230px; top: 110px; right: 30px; font-size: 16px; }
.card .fields .f { margin-bottom: 9px; }
.card .fields .k { font-size: 10px; letter-spacing: 0.14em; color: #444; display: block; }
.card .fields .v { font-size: 20px; font-weight: bold; }
.card .fields .v.id { font-size: 24px; }
.card .foot { position: absolute; left: 30px; right: 30px; bottom: 18px; font-size: 10px; color: #555; display: flex; justify-content: space-between; }
.card .sigl { position: absolute; right: 40px; bottom: 44px; font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 26px; }
.cert { text-align: center; }
.cert .seal { width: 110px; height: 110px; border: 4px double #000; border-radius: 50%; margin: 10px auto; display: flex; align-items: center; justify-content: center; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.1em; padding: 10px; }
.cert .name { font-size: 32px; margin: 10px 0; font-weight: bold; }
.cert .num { font-family: Arial, Helvetica, sans-serif; font-size: 18px; margin: 8px 0; }
.cert p { margin: 6px 0; }
`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body><div class="page">${body}</div></body></html>`;
const cardPage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS} body{background:#fff}</style></head><body>${body}</body></html>`;

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- Household: Jordan Reyes --------------------------------------------------
const H = {
  tenant: 'Jordan Reyes',
  spouse: 'Casey Reyes',
  child: 'Mia Reyes',
  dob: '03/14/1989',
  address: '1427 Riverbend Ave, Apt 3B, Nashville, TN 37206',
  landlord: 'Riverbend Property Management',
  landlordPhone: '(615) 555-0160',
  rent: 950,
  employer: 'Walmart',
  bank: 'First Cumberland Bank',
};

function driverLicense({ name, dob, issued, expires, number }) {
  return cardPage(
    'Driver License',
    `<div class="card">
      <div class="state">TENNESSEE</div>
      <div class="kind">Driver License · Class D</div>
      <div class="photo">PHOTO<br>(synthetic sample)</div>
      <div class="fields">
        <div class="f"><span class="k">DL NO</span><span class="v id">${number}</span></div>
        <div class="f"><span class="k">NAME</span><span class="v">${name.toUpperCase()}</span></div>
        <div class="f"><span class="k">ADDRESS</span><span class="v" style="font-size:15px;font-weight:normal">${H.address}</span></div>
        <div class="f" style="display:flex;gap:28px"><span><span class="k">DOB</span><span class="v">${dob}</span></span><span><span class="k">ISS</span><span class="v">${issued}</span></span><span><span class="k">EXP</span><span class="v">${expires}</span></span></div>
        <div class="f" style="display:flex;gap:28px"><span><span class="k">SEX</span><span class="v" style="font-size:16px">X</span></span><span><span class="k">HGT</span><span class="v" style="font-size:16px">5'-09"</span></span><span><span class="k">EYES</span><span class="v" style="font-size:16px">BRO</span></span><span><span class="k">END</span><span class="v" style="font-size:16px">NONE</span></span></div>
      </div>
      <div class="sigl">${name}</div>
      <div class="foot"><span>DD 0412-${number.slice(-4)}-TEST</span><span>TN DEPT OF SAFETY & HOMELAND SECURITY</span></div>
    </div>`,
  );
}

function payStub({ employee, employer, periodStart, periodEnd, payDate, gross, net, address }) {
  return page(
    'Earnings Statement',
    `<header><div class="org">${employer} · Payroll Services</div><h1>Earnings Statement</h1><div class="sub">Store #4118 · Nashville, TN</div></header>
    <table><tr><th>Employee</th><td>${employee}<br>${address}</td><th>Employee ID</th><td>00${employer.length}7${employee.length}48</td></tr>
    <tr><th>Pay period</th><td>${periodStart} – ${periodEnd}</td><th>Pay date</th><td>${payDate}</td></tr></table>
    <div class="box"><div class="lbl">Pay period</div><div class="big">${periodStart} – ${periodEnd}</div></div>
    <table><tr><th>Earnings</th><th>Rate</th><th>Hours</th><th class="right">Current</th><th class="right">Year to date</th></tr>
    <tr><td>Regular</td><td>$14.50</td><td>${(gross / 14.5).toFixed(2)}</td><td class="right">${money(gross)}</td><td class="right">${money(gross * 21)}</td></tr>
    <tr><td><b>Gross pay</b></td><td></td><td></td><td class="right"><b>${money(gross)}</b></td><td class="right">${money(gross * 21)}</td></tr></table>
    <table><tr><th>Deductions</th><th class="right">Current</th><th class="right">Year to date</th></tr>
    <tr><td>Federal income tax</td><td class="right">${money(gross * 0.06)}</td><td class="right">${money(gross * 0.06 * 21)}</td></tr>
    <tr><td>Social Security</td><td class="right">${money(gross * 0.062)}</td><td class="right">${money(gross * 0.062 * 21)}</td></tr>
    <tr><td>Medicare</td><td class="right">${money(gross * 0.0145)}</td><td class="right">${money(gross * 0.0145 * 21)}</td></tr>
    <tr><td><b>Net pay</b></td><td class="right"><b>${money(net)}</b></td><td class="right">${money(net * 21)}</td></tr></table>
    <p class="fine">Direct deposit to ${H.bank} account ending 4471. Questions: Payroll Services, 1-800-555-0199.</p>`,
  );
}

function lease({ term, rent, signed, h = H }) {
  return page(
    'Residential Lease Agreement',
    `<header><div class="org">${h.landlord}</div><h1>Residential Lease Agreement</h1><div class="sub">${h.address}</div></header>
    <p>This Residential Lease Agreement ("Agreement") is made between <b>${h.landlord}</b> ("Landlord"), ${h.landlordPhone}, and <b>${h.tenant}</b>${h.spouse ? ` and <b>${h.spouse}</b>` : ''} ("Tenant"), for the premises located at <b>${h.address}</b> (the "Premises").${h.child ? ` Other occupants: ${h.child} (minor child).` : ''}</p>
    <div class="box"><div class="lbl">Lease term</div><div class="big">${term.start} through ${term.end}</div></div>
    <p><b>1. Rent.</b> Tenant agrees to pay Landlord monthly rent of <b>${money(rent)}</b>, due on the first day of each month, by check or electronic payment.</p>
    <p><b>2. Security deposit.</b> Tenant has deposited ${money(rent)} as a security deposit, held in accordance with Tennessee law.</p>
    <p><b>3. Utilities.</b> Water and sewer service are included in the monthly rent. Electricity and natural gas are the responsibility of the Tenant.</p>
    <p><b>4. Use.</b> The Premises shall be used solely as a private residence for the Tenant and the occupants named above.</p>
    <p><b>5. Renewal.</b> This Agreement does not renew automatically. Any renewal requires a new written agreement signed by both parties.</p>
    <div class="sig"><div>${h.landlord}<br>Landlord · signed ${signed}</div><div>${h.tenant}<br>Tenant · signed ${signed}</div>${h.spouse ? `<div>${h.spouse}<br>Tenant · signed ${signed}</div>` : ''}</div>`,
  );
}

function bankStatement({ holder, periodStart, periodEnd, opening, closing, bank }) {
  const rows = [
    ['Walmart payroll deposit', 508.0],
    ['Riverbend Property Mgmt — rent', -950.0],
    ['Kroger payroll deposit', 207.69],
    ['Nashville Electric Service', -84.2],
    ['Grocery — Food Lion', -112.55],
    ['Walmart payroll deposit', 508.0],
  ];
  let bal = opening;
  return page(
    'Account Statement',
    `<header><div class="org">${bank}</div><h1>Checking Account Statement</h1><div class="sub">Account ending 4471 · Statement period ${periodStart} – ${periodEnd}</div></header>
    <table><tr><th>Account holder</th><td>${holder}<br>${H.address}</td><th>Statement date</th><td>${periodEnd}</td></tr></table>
    <div class="box"><div class="lbl">Statement period</div><div class="big">${periodStart} – ${periodEnd}</div></div>
    <table><tr><th>Beginning balance</th><th>Deposits</th><th>Withdrawals</th><th>Ending balance</th></tr>
    <tr><td>${money(opening)}</td><td>${money(rows.filter((r) => r[1] > 0).reduce((s, r) => s + r[1], 0))}</td><td>${money(-rows.filter((r) => r[1] < 0).reduce((s, r) => s + r[1], 0))}</td><td><b>${money(closing)}</b></td></tr></table>
    <table><tr><th>Date</th><th>Description</th><th class="right">Amount</th><th class="right">Balance</th></tr>
    ${rows
      .map((r, i) => {
        bal += r[1];
        const d = new Date(periodStart);
        d.setDate(d.getDate() + 3 + i * 4);
        return `<tr><td>${d.toLocaleDateString('en-US')}</td><td>${r[0]}</td><td class="right">${r[1] < 0 ? '-' : ''}${money(Math.abs(r[1]))}</td><td class="right">${money(bal)}</td></tr>`;
      })
      .join('')}
    </table><p class="fine">Member FDIC. This statement is for the account holder's records.</p>`,
  );
}

function utilityBill({ customer, serviceAddress, billDate, due, amount, utility = 'Nashville Electric Service', account = '4418-2207-11' }) {
  return page(
    'Electric Service Bill',
    `<header><div class="org">${utility}</div><h1>Electric Service Bill</h1><div class="sub">Account ${account}</div></header>
    <table><tr><th>Customer</th><td>${customer}</td><th>Bill date</th><td>${billDate}</td></tr><tr><th>Service address</th><td>${serviceAddress}</td><th>Due date</th><td>${due}</td></tr></table>
    <div class="box"><div class="lbl">Amount due</div><div class="big">${money(amount)}</div></div>
    <table><tr><th>Meter</th><th>Previous</th><th>Current</th><th>kWh used</th><th class="right">Charge</th></tr><tr><td>E-220918</td><td>41,207</td><td>41,864</td><td>657</td><td class="right">${money(amount - 12.5)}</td></tr><tr><td colspan="4">Basic service charge</td><td class="right">${money(12.5)}</td></tr></table>`,
  );
}

// --- Provider: Elena Vasquez, MD --------------------------------------------------
const P = {
  name: 'Elena Vasquez, MD',
  plain: 'Elena Vasquez',
  license: 'MD-48213',
  dea: 'BV4821367',
  abim: '318842',
  policy: 'PL-7730415',
  practice: 'Cumberland Internal Medicine Group',
  address: '2200 Church Street, Suite 410, Nashville, TN 37203',
};

function medicalLicense({ name, number, issued, expires }) {
  return page(
    'License to Practice Medicine',
    `<div class="cert"><div class="org">State of Tennessee · Department of Health</div><h1>Board of Medical Examiners</h1>
    <div class="seal">BOARD OF MEDICAL EXAMINERS · TENNESSEE</div>
    <p>This certifies that</p><div class="name">${name}</div>
    <p>has met the requirements of Tennessee Code Annotated Title 63, Chapter 6, and is hereby granted a</p>
    <h2 style="margin:6px 0">License to Practice Medicine and Surgery</h2>
    <div class="num">License Number <b>${number}</b></div>
    <div class="box" style="max-width:520px;margin:18px auto"><div class="lbl">License valid</div><div class="big">${issued} through ${expires}</div></div>
    <p>Status: <b>Active</b> · License type: Medical Doctor (MD) · Specialty: Internal Medicine</p>
    <div class="stamp">OFFICIAL RECORD</div>
    <div class="sig"><div>Executive Director, Board of Medical Examiners</div><div>Commissioner of Health</div></div>
    <p class="fine">Verify this license at the Tennessee Department of Health license verification portal.</p></div>`,
  );
}

function deaCertificate({ name, number, expires, issued, p = P }) {
  return page(
    'DEA Certificate of Registration',
    `<div class="cert"><div class="org">United States Department of Justice · Drug Enforcement Administration</div><h1>Certificate of Registration</h1>
    <div class="seal">DEA · CONTROLLED SUBSTANCES</div>
    <table style="max-width:600px;margin:14px auto"><tr><th>DEA registration number</th><td><b>${number}</b></td></tr><tr><th>Registrant</th><td>${name}<br>${p.practice}<br>${p.address}</td></tr><tr><th>Business activity</th><td>Practitioner</td></tr><tr><th>Schedules</th><td>2, 2N, 3, 3N, 4, 5</td></tr><tr><th>Issue date</th><td>${issued}</td></tr><tr><th>Expiration date</th><td><b>${expires}</b></td></tr></table>
    <div class="box" style="max-width:520px;margin:18px auto"><div class="lbl">Expiration date</div><div class="big">${expires}</div></div>
    <p class="fine">This registration is not transferable. Registrant must notify DEA of any change of address or business activity.</p></div>`,
  );
}

function boardCert({ name, number, valid }) {
  return page(
    'Board Certification',
    `<div class="cert"><div class="org">American Board of Internal Medicine</div><h1>Certificate of Board Certification</h1>
    <div class="seal">ABIM · INTERNAL MEDICINE</div>
    <p>The American Board of Internal Medicine certifies that</p><div class="name">${name}</div>
    <p>has satisfied the requirements of the Board and is certified in</p><h2 style="margin:6px 0">Internal Medicine</h2>
    <div class="num">Certificate Number <b>${number}</b></div>
    <div class="box" style="max-width:520px;margin:18px auto"><div class="lbl">Certification valid</div><div class="big">${valid.start} through ${valid.end}</div></div>
    <p>Maintenance of Certification status: <b>${valid.status}</b></p>
    <div class="sig"><div>Chair, Board of Directors</div><div>President and Chief Executive Officer</div></div></div>`,
  );
}

function insuranceCert({ insured, policy, effective, expires, carrier, p = P }) {
  return page(
    'Certificate of Liability Insurance',
    `<header><div class="org">${carrier}</div><h1>Certificate of Liability Insurance</h1><div class="sub">Professional Liability (Medical Malpractice) · Claims-made</div></header>
    <table><tr><th>Insured</th><td>${insured}<br>${p.practice}<br>${p.address}</td><th>Certificate holder</th><td>TennCare Provider Enrollment<br>310 Great Circle Road, Nashville, TN 37243</td></tr></table>
    <table><tr><th>Policy number</th><th>Coverage</th><th>Effective</th><th>Expiration</th><th>Limits</th></tr>
    <tr><td><b>${policy}</b></td><td>Professional liability</td><td>${effective}</td><td><b>${expires}</b></td><td>$1,000,000 each claim / $3,000,000 aggregate</td></tr></table>
    <div class="box"><div class="lbl">Policy period</div><div class="big">${effective} – ${expires}</div></div>
    <p class="fine">This certificate is issued as a matter of information only and confers no rights upon the certificate holder. Should the policy be cancelled before the expiration date, notice will be delivered in accordance with the policy provisions.</p>
    <div class="sig"><div>Authorized representative, ${carrier}</div></div>`,
  );
}

// --- Write everything ---------------------------------------------------------------
const docs = [];
function add(group, task, expected, why, name, html) {
  writeFileSync(join(OUT, `${name}.html`), html);
  docs.push({ group, task, expected, why, files: [`${name}.pdf`, `${name}.png`] });
}

// Household
add('household', 'Photo ID — Jordan Reyes', 'pass', 'Tennessee driver license in Jordan Reyes’s name, expires 2029.', 'hh-photo-id-pass', driverLicense({ name: H.tenant, dob: H.dob, issued: '03/14/2025', expires: '03/14/2029', number: '118204476' }));
add('household', 'Photo ID — Jordan Reyes', 'fail', 'Same license, expired 03/14/2024 → “no longer in effect”.', 'hh-photo-id-fail-expired', driverLicense({ name: H.tenant, dob: H.dob, issued: '03/14/2020', expires: '03/14/2024', number: '118204476' }));
add('household', 'Photo ID — Jordan Reyes', 'fail', 'Valid license, but for Sam Whitaker → “belongs to someone else”.', 'hh-photo-id-fail-wrong-person', driverLicense({ name: 'Sam Whitaker', dob: '07/22/1984', issued: '01/10/2025', expires: '01/10/2029', number: '227311905' }));
add('household', 'Pay stubs — Jordan (Walmart)', 'pass', 'Walmart earnings statement for Jordan Reyes, pay period Oct 11–24, 2026 (biweekly ≈ $1,100/mo).', 'hh-paystub-pass', payStub({ employee: H.tenant, employer: 'Walmart', periodStart: '10/11/2026', periodEnd: '10/24/2026', payDate: '10/30/2026', gross: 507.69, net: 441.2, address: H.address }));
add('household', 'Pay stubs — Jordan (Walmart)', 'fail', 'Same statement from October 2024 → outside the last-30-days window.', 'hh-paystub-fail-old', payStub({ employee: H.tenant, employer: 'Walmart', periodStart: '10/13/2024', periodEnd: '10/26/2024', payDate: '11/01/2024', gross: 492.3, net: 428.1, address: H.address }));
add('household', 'Pay stubs — Jordan (Walmart)', 'fail', 'Current stub from Target, not Walmart → employer contradicts the application.', 'hh-paystub-fail-wrong-employer', payStub({ employee: H.tenant, employer: 'Target', periodStart: '10/11/2026', periodEnd: '10/24/2026', payDate: '10/30/2026', gross: 612.0, net: 530.4, address: H.address }));
add('household', 'Bank statements (last 60 days)', 'pass', 'First Cumberland Bank statement for Jordan Reyes, Sept 25 – Oct 24, 2026.', 'hh-bank-statement-pass', bankStatement({ holder: H.tenant, periodStart: '09/25/2026', periodEnd: '10/24/2026', opening: 312.44, closing: 389.38, bank: H.bank }));
add('household', 'Bank statements (last 60 days)', 'fail', 'Statement from spring 2025 → too old to show current resources.', 'hh-bank-statement-fail-old', bankStatement({ holder: H.tenant, periodStart: '03/25/2025', periodEnd: '04/24/2025', opening: 288.1, closing: 365.04, bank: H.bank }));
add('household', 'Lease agreement', 'pass', 'Current lease, April 2026 – March 2027, rent $950 — matches the application.', 'hh-lease-pass', lease({ term: { start: 'April 1, 2026', end: 'March 31, 2027' }, rent: 950, signed: 'March 15, 2026' }));
add('household', 'Lease agreement', 'fail', 'Prior lease that ended March 2024 at $875 → lapsed AND rent contradicts the application.', 'hh-lease-fail-expired', lease({ term: { start: 'April 1, 2023', end: 'March 31, 2024' }, rent: 875, signed: 'March 15, 2023' }));
add('household', 'Lease agreement', 'fail', 'A utility bill uploaded for the lease item → wrong document type.', 'hh-lease-fail-wrong-type', utilityBill({ customer: H.tenant, serviceAddress: H.address, billDate: '10/18/2026', due: '11/08/2026', amount: 96.7 }));
add('household', 'Utility bill', 'pass', 'October 2026 electric bill at the service address in Jordan’s name.', 'hh-utility-bill-pass', utilityBill({ customer: H.tenant, serviceAddress: H.address, billDate: '10/18/2026', due: '11/08/2026', amount: 96.7 }));

// Provider
add('provider', 'Photo ID — Elena Vasquez', 'pass', 'Tennessee driver license in Elena Vasquez’s name, expires 2028.', 'prv-photo-id-pass', driverLicense({ name: 'Elena Vasquez', dob: '09/02/1981', issued: '09/02/2024', expires: '09/02/2028', number: '330917744' }).replace(H.address, '4120 Belmont Blvd, Nashville, TN 37215'));
add('provider', 'Photo ID — Elena Vasquez', 'fail', 'Same license, expired 09/02/2023 → “no longer in effect”.', 'prv-photo-id-fail-expired', driverLicense({ name: 'Elena Vasquez', dob: '09/02/1981', issued: '09/02/2019', expires: '09/02/2023', number: '330917744' }).replace(H.address, '4120 Belmont Blvd, Nashville, TN 37215'));
add('provider', 'Tennessee medical license MD-48213', 'pass', 'Active TN medical license MD-48213 for Elena Vasquez, valid through June 30, 2027.', 'prv-license-pass', medicalLicense({ name: P.name, number: P.license, issued: 'July 1, 2025', expires: 'June 30, 2027' }));
add('provider', 'Tennessee medical license MD-48213', 'fail', 'Same license, but the term ended June 30, 2024 → lapsed.', 'prv-license-fail-expired', medicalLicense({ name: P.name, number: P.license, issued: 'July 1, 2023', expires: 'June 30, 2024' }));
add('provider', 'Tennessee medical license MD-48213', 'fail', 'Current license, but number MD-51902 for Daniel Okoro, MD → wrong licensee and number.', 'prv-license-fail-wrong-licensee', medicalLicense({ name: 'Daniel Okoro, MD', number: 'MD-51902', issued: 'July 1, 2025', expires: 'June 30, 2027' }));
add('provider', 'DEA registration BV4821367', 'pass', 'DEA certificate BV4821367 for Elena Vasquez, expires March 31, 2027.', 'prv-dea-pass', deaCertificate({ name: P.name, number: P.dea, issued: 'April 1, 2024', expires: 'March 31, 2027' }));
add('provider', 'DEA registration BV4821367', 'fail', 'Same certificate, expired March 31, 2025 → lapsed.', 'prv-dea-fail-expired', deaCertificate({ name: P.name, number: P.dea, issued: 'April 1, 2022', expires: 'March 31, 2025' }));
add('provider', 'ABIM board certification', 'pass', 'ABIM Internal Medicine certificate 318842, valid through December 31, 2030.', 'prv-board-cert-pass', boardCert({ name: P.name, number: P.abim, valid: { start: 'January 1, 2021', end: 'December 31, 2030', status: 'Participating' } }));
add('provider', 'ABIM board certification', 'fail', 'Same certificate, certification ended December 31, 2024 → lapsed.', 'prv-board-cert-fail-expired', boardCert({ name: P.name, number: P.abim, valid: { start: 'January 1, 2015', end: 'December 31, 2024', status: 'Not participating' } }));
add('provider', 'Professional liability insurance', 'pass', 'MedPro certificate for policy PL-7730415, in force Feb 1, 2026 – Jan 31, 2027.', 'prv-insurance-pass', insuranceCert({ insured: P.name, policy: P.policy, effective: 'February 1, 2026', expires: 'January 31, 2027', carrier: 'MedPro Mutual Assurance' }));
add('provider', 'Professional liability insurance', 'fail', 'Policy expired January 31, 2025 → lapsed.', 'prv-insurance-fail-expired', insuranceCert({ insured: P.name, policy: P.policy, effective: 'February 1, 2024', expires: 'January 31, 2025', carrier: 'MedPro Mutual Assurance' }));
add('provider', 'Professional liability insurance', 'fail', 'Current certificate for policy PL-9910227 → policy number contradicts the application.', 'prv-insurance-fail-wrong-policy', insuranceCert({ insured: P.name, policy: 'PL-9910227', effective: 'February 1, 2026', expires: 'January 31, 2027', carrier: 'MedPro Mutual Assurance' }));
add('provider', 'Tennessee medical license MD-48213', 'fail', 'The DEA certificate uploaded for the state-license item → wrong document type.', 'prv-license-fail-wrong-type', deaCertificate({ name: P.name, number: P.dea, issued: 'April 1, 2024', expires: 'March 31, 2027' }));

// --- Vadim Vishnepolsky — the live-contact test household (HH-2026-00402) and provider (PRV-2026-00071)
const V = {
  tenant: 'Vadim Vishnepolsky',
  spouse: '',
  child: '',
  dob: '06/18/1985',
  address: '2100 West End Ave, Apt 12, Nashville, TN 37203',
  landlord: 'West End Property Management',
  landlordPhone: '(615) 555-0177',
};
const VP = { practice: 'West End Family Practice', address: '2100 West End Ave, Suite 300, Nashville, TN 37203' };
const vLicense = (id) => driverLicense({ name: V.tenant, dob: V.dob, issued: '06/18/2024', expires: '06/18/2028', number: id }).replace(H.address, V.address);
add('household', 'Photo ID — Vadim Vishnepolsky', 'pass', 'Tennessee driver license in Vadim Vishnepolsky’s name, expires 2028.', 'vv-photo-id-pass', vLicense('441209318'));
add('household', 'Photo ID — Vadim Vishnepolsky', 'fail', 'Same license, expired 06/18/2023 → “no longer in effect”.', 'vv-photo-id-fail-expired', driverLicense({ name: V.tenant, dob: V.dob, issued: '06/18/2019', expires: '06/18/2023', number: '441209318' }).replace(H.address, V.address));
add('household', 'Pay stubs — Vadim (Walmart)', 'pass', 'Walmart earnings statement for Vadim, pay period Oct 11–24, 2026.', 'vv-paystub-pass', payStub({ employee: V.tenant, employer: 'Walmart', periodStart: '10/11/2026', periodEnd: '10/24/2026', payDate: '10/30/2026', gross: 507.69, net: 441.2, address: V.address }));
add('household', 'Pay stubs — Vadim (Walmart)', 'fail', 'Same statement from October 2024 → outside the last-30-days window.', 'vv-paystub-fail-old', payStub({ employee: V.tenant, employer: 'Walmart', periodStart: '10/13/2024', periodEnd: '10/26/2024', payDate: '11/01/2024', gross: 492.3, net: 428.1, address: V.address }));
add('household', 'Bank statements (last 60 days)', 'pass', 'First Cumberland Bank statement for Vadim, Sept 25 – Oct 24, 2026.', 'vv-bank-statement-pass', bankStatement({ holder: V.tenant, periodStart: '09/25/2026', periodEnd: '10/24/2026', opening: 540.1, closing: 617.04, bank: H.bank }).replace(H.address, V.address));
add('household', 'Lease agreement', 'pass', 'Current lease, April 2026 – March 2027, rent $950 — matches the application.', 'vv-lease-pass', lease({ term: { start: 'April 1, 2026', end: 'March 31, 2027' }, rent: 950, signed: 'March 15, 2026', h: V }));
add('household', 'Lease agreement', 'fail', 'Prior lease that ended March 2024 at $875 → lapsed AND rent contradicts the application.', 'vv-lease-fail-expired', lease({ term: { start: 'April 1, 2023', end: 'March 31, 2024' }, rent: 875, signed: 'March 15, 2023', h: V }));
add('household', 'Utility bill', 'pass', 'October 2026 electric bill at the service address in Vadim’s name.', 'vv-utility-bill-pass', utilityBill({ customer: V.tenant, serviceAddress: V.address, billDate: '10/18/2026', due: '11/08/2026', amount: 102.4 }));
// Proof of residency — the item a worker adds after CLEAR reports active out-of-state (New York) Medicaid.
add('household', 'Proof of where you live (worker-added)', 'pass', 'Reuse vv-utility-bill-pass: current bill at the Tennessee address in Vadim’s name.', 'vv-residency-pass', utilityBill({ customer: V.tenant, serviceAddress: V.address, billDate: '10/18/2026', due: '11/08/2026', amount: 102.4 }));
add('household', 'Proof of where you live (worker-added)', 'fail', 'Current Con Edison bill in Vadim’s name at a New York service address → contradicts the Tennessee address / state on the application.', 'vv-residency-fail-out-of-state', utilityBill({ customer: V.tenant, serviceAddress: '245 W 54th St, Apt 7C, New York, NY 10019', billDate: '10/16/2026', due: '11/06/2026', amount: 118.3, utility: 'Con Edison', account: '72-1190-4457-002' }));
add('household', 'Proof of where you live (worker-added)', 'fail', 'Bill at the Tennessee address but dated March 2025 → older than 60 days, no longer shows where they live now.', 'vv-residency-fail-old', utilityBill({ customer: V.tenant, serviceAddress: V.address, billDate: '03/18/2025', due: '04/08/2025', amount: 131.9 }));
add('provider', 'Photo ID — Vadim Vishnepolsky', 'pass', 'Tennessee driver license in Vadim Vishnepolsky’s name, expires 2028.', 'vvp-photo-id-pass', vLicense('441209318'));
add('provider', 'Tennessee medical license MD-50117', 'pass', 'Active TN medical license MD-50117 for Vadim Vishnepolsky, MD, valid through July 31, 2027.', 'vvp-license-pass', medicalLicense({ name: 'Vadim Vishnepolsky, MD', number: 'MD-50117', issued: 'August 1, 2025', expires: 'July 31, 2027' }));
add('provider', 'Tennessee medical license MD-50117', 'fail', 'Same license, but the term ended July 31, 2024 → lapsed.', 'vvp-license-fail-expired', medicalLicense({ name: 'Vadim Vishnepolsky, MD', number: 'MD-50117', issued: 'August 1, 2023', expires: 'July 31, 2024' }));
add('provider', 'DEA registration BV5011742', 'pass', 'DEA certificate BV5011742 for Vadim Vishnepolsky, MD, expires May 31, 2027.', 'vvp-dea-pass', deaCertificate({ name: 'Vadim Vishnepolsky, MD', number: 'BV5011742', issued: 'June 1, 2024', expires: 'May 31, 2027', p: VP }));
add('provider', 'Professional liability insurance', 'pass', 'MedPro certificate for policy PL-8841206, in force Apr 1, 2026 – Mar 31, 2027.', 'vvp-insurance-pass', insuranceCert({ insured: 'Vadim Vishnepolsky, MD', policy: 'PL-8841206', effective: 'April 1, 2026', expires: 'March 31, 2027', carrier: 'MedPro Mutual Assurance', p: VP }));
add('provider', 'Professional liability insurance', 'fail', 'Policy expired March 31, 2025 → lapsed.', 'vvp-insurance-fail-expired', insuranceCert({ insured: 'Vadim Vishnepolsky, MD', policy: 'PL-8841206', effective: 'April 1, 2024', expires: 'March 31, 2025', carrier: 'MedPro Mutual Assurance', p: VP }));

writeFileSync(join(OUT, 'index.json'), JSON.stringify(docs, null, 2));
writeFileSync(
  join(OUT, 'README.md'),
  `# Test documents

Synthetic documents for exercising the AI first-pass review. Generated by
\`scripts/generate-test-documents.mjs\`; PDFs and PNGs rendered by
\`scripts/render-test-documents.sh\` (headless Chrome). Do not hand-edit the
HTML — change the generator and re-run \`npm run test-documents\`.

Documents prefixed "hh-" belong to the seeded **Jordan Reyes** household
(HH-2026-00418), "prv-" to **Elena Vasquez, MD** (PRV-2026-00077), and "vv-" /
"vvp-" to the live-contact test household and provider **Vadim Vishnepolsky**
(HH-2026-00402 / PRV-2026-00071). Every address, number, license and NPI is
fabricated.

| File | Expected | Why |
| --- | --- | --- |
${docs.map((d) => `| ${d.files[0]} | ${d.expected} | ${d.why.replace(/\|/g, '/')} |`).join('\n')}
`,
);
console.log(`wrote ${docs.length} documents to ${OUT}`);
