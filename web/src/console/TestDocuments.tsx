import { useEffect, useState } from 'react';
import { api, type TestDocument } from '../api';
import { Pill } from './ui';

export function TestDocuments() {
  const [docs, setDocs] = useState<TestDocument[] | null>(null);
  useEffect(() => {
    api<{ documents: TestDocument[] }>('/api/test-documents').then((r) => setDocs(r.documents));
  }, []);
  const groups: { key: TestDocument['group']; title: string; blurb: string }[] = [
    { key: 'household', title: 'Household — Jordan Reyes (HH-2026-00418)', blurb: 'Open the household, text the secure link, then upload these on the hosted flow. Each pair isolates one thing the AI review should catch.' },
    { key: 'provider', title: 'Provider — Elena Vasquez, MD (PRV-2026-00077)', blurb: 'Open the provider, email the secure link, then upload these. License and certificate pairs differ only in dates, names or numbers.' },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Test documents</h1>
          <p className="sub">Synthetic documents built to pass or fail the AI first-pass review. Every name, number and address is fabricated. Download, then upload them through the hosted flow.</p>
        </div>
      </div>
      {docs && docs.length === 0 && <div className="alert warning">No generated documents found. Run <code className="inline">npm run test-documents</code> and commit the output under docs/test-documents.</div>}
      {groups.map((g) => (
        <div key={g.key} className="card">
          <div className="cake">
            <div>
              <h2>{g.title}</h2>
              <div className="meta">{g.blurb}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="docgrid">
              {(docs ?? [])
                .filter((d) => d.group === g.key)
                .map((d, i) => (
                  <div key={i} className="doc">
                    <div className="t">
                      <span>{d.task}</span>
                      <Pill tone={d.expected === 'pass' ? 'success' : 'warning'}>{d.expected === 'pass' ? 'Should pass' : 'Should flag'}</Pill>
                    </div>
                    <div className="why">{d.why}</div>
                    <div className="links">
                      {d.files.map((f) => (
                        <a key={f.name} href={f.url} download={f.name}>
                          {f.name}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
