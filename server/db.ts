/**
 * Persistence: cases, verification requests (JSONB aggregates) and uploaded
 * file bytes. Postgres when DATABASE_URL is set (what Render runs), otherwise
 * an in-memory store for local dev. Mirrors ht-ai-care-coordinator's db.ts.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { env } from './env.js';
import type { CaseData, CaseRecord } from './domain/case.js';
import type { CaseKind, VerificationRequest } from './domain/types.js';

export interface StoredFile {
  id: string;
  request_id: string;
  task_id: string;
  mime: string;
  filename: string | null;
  bytes: Buffer;
  created_at: string;
}

export interface Store {
  init(): Promise<void>;
  // cases
  listCases(kind?: CaseKind): Promise<CaseRecord[]>;
  getCase(id: string): Promise<CaseRecord | null>;
  countCases(): Promise<number>;
  createCase(kind: CaseKind, subjectName: string, data: CaseData): Promise<CaseRecord>;
  updateCase(id: string, subjectName: string, data: CaseData): Promise<CaseRecord | null>;
  deleteCase(id: string): Promise<boolean>;
  // requests
  listRequests(filter?: { caseId?: string; status?: string[] }): Promise<VerificationRequest[]>;
  getRequest(id: string): Promise<VerificationRequest | null>;
  findRequestByTokenHash(hash: string): Promise<VerificationRequest | null>;
  insertRequest(r: VerificationRequest): Promise<void>;
  saveRequest(r: VerificationRequest): Promise<void>;
  // files
  putFile(f: Omit<StoredFile, 'created_at'>): Promise<void>;
  getFile(id: string): Promise<StoredFile | null>;
  deleteFilesForTask(requestId: string, taskId: string): Promise<void>;
  deleteAll(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  subject_name text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verification_requests (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_requests_case_idx ON verification_requests (case_id);
CREATE INDEX IF NOT EXISTS verification_requests_status_idx ON verification_requests (status);
CREATE TABLE IF NOT EXISTS uploaded_files (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  mime text NOT NULL,
  filename text,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploaded_files_request_idx ON uploaded_files (request_id);
`;

interface CaseRow {
  id: string;
  kind: CaseKind;
  subject_name: string;
  data: CaseData;
  created_at: Date;
  updated_at: Date;
}
interface RequestRow {
  body: VerificationRequest;
}

const caseFromRow = (r: CaseRow): CaseRecord => ({
  id: r.id,
  kind: r.kind,
  subject_name: r.subject_name,
  data: r.data,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

export const pgPool: pg.Pool | null = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 8,
      ssl: /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    })
  : null;

class PgStore implements Store {
  constructor(private pool: pg.Pool) {}
  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }
  async listCases(kind?: CaseKind): Promise<CaseRecord[]> {
    const { rows } = kind
      ? await this.pool.query<CaseRow>('SELECT * FROM cases WHERE kind = $1 ORDER BY created_at DESC LIMIT 500', [kind])
      : await this.pool.query<CaseRow>('SELECT * FROM cases ORDER BY created_at DESC LIMIT 500');
    return rows.map(caseFromRow);
  }
  async getCase(id: string): Promise<CaseRecord | null> {
    const { rows } = await this.pool.query<CaseRow>('SELECT * FROM cases WHERE id = $1', [id]);
    return rows[0] ? caseFromRow(rows[0]) : null;
  }
  async countCases(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM cases');
    return Number(rows[0]?.n ?? 0);
  }
  async createCase(kind: CaseKind, subjectName: string, data: CaseData): Promise<CaseRecord> {
    const { rows } = await this.pool.query<CaseRow>(
      'INSERT INTO cases (id, kind, subject_name, data) VALUES ($1,$2,$3,$4::jsonb) RETURNING *',
      [randomUUID(), kind, subjectName, JSON.stringify(data)],
    );
    return caseFromRow(rows[0] as CaseRow);
  }
  async updateCase(id: string, subjectName: string, data: CaseData): Promise<CaseRecord | null> {
    const { rows } = await this.pool.query<CaseRow>(
      'UPDATE cases SET subject_name = $2, data = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING *',
      [id, subjectName, JSON.stringify(data)],
    );
    return rows[0] ? caseFromRow(rows[0]) : null;
  }
  async deleteCase(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM cases WHERE id = $1', [id]);
    return (rowCount ?? 0) === 1;
  }
  async listRequests(filter?: { caseId?: string; status?: string[] }): Promise<VerificationRequest[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filter?.caseId) {
      values.push(filter.caseId);
      where.push(`case_id = $${values.length}`);
    }
    if (filter?.status && filter.status.length > 0) {
      values.push(filter.status);
      where.push(`status = ANY($${values.length}::text[])`);
    }
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT body FROM verification_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`,
      values,
    );
    return rows.map((r) => r.body);
  }
  async getRequest(id: string): Promise<VerificationRequest | null> {
    const { rows } = await this.pool.query<RequestRow>('SELECT body FROM verification_requests WHERE id = $1', [id]);
    return rows[0]?.body ?? null;
  }
  async findRequestByTokenHash(hash: string): Promise<VerificationRequest | null> {
    const { rows } = await this.pool.query<RequestRow>('SELECT body FROM verification_requests WHERE token_hash = $1', [hash]);
    return rows[0]?.body ?? null;
  }
  async insertRequest(r: VerificationRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO verification_requests (id, case_id, kind, status, token_hash, token_expires_at, body, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [r.id, r.case_id, r.kind, r.status, r.token_hash, r.token_expires_at, JSON.stringify(r), r.created_at, r.updated_at],
    );
  }
  async saveRequest(r: VerificationRequest): Promise<void> {
    await this.pool.query(
      `UPDATE verification_requests SET status = $2, token_hash = $3, token_expires_at = $4, body = $5::jsonb, updated_at = $6 WHERE id = $1`,
      [r.id, r.status, r.token_hash, r.token_expires_at, JSON.stringify(r), r.updated_at],
    );
  }
  async putFile(f: Omit<StoredFile, 'created_at'>): Promise<void> {
    await this.pool.query(
      'INSERT INTO uploaded_files (id, request_id, task_id, mime, filename, bytes) VALUES ($1,$2,$3,$4,$5,$6)',
      [f.id, f.request_id, f.task_id, f.mime, f.filename, f.bytes],
    );
  }
  async getFile(id: string): Promise<StoredFile | null> {
    const { rows } = await this.pool.query<{
      id: string;
      request_id: string;
      task_id: string;
      mime: string;
      filename: string | null;
      bytes: Buffer;
      created_at: Date;
    }>('SELECT * FROM uploaded_files WHERE id = $1', [id]);
    const r = rows[0];
    return r ? { ...r, created_at: r.created_at.toISOString() } : null;
  }
  async deleteFilesForTask(requestId: string, taskId: string): Promise<void> {
    await this.pool.query('DELETE FROM uploaded_files WHERE request_id = $1 AND task_id = $2', [requestId, taskId]);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('DELETE FROM cases');
  }
}

class MemoryStore implements Store {
  private cases = new Map<string, CaseRecord>();
  private requests = new Map<string, VerificationRequest>();
  private files = new Map<string, StoredFile>();
  async init(): Promise<void> {
    console.warn('[db] DATABASE_URL not set — using the in-memory store (data is lost on restart)');
  }
  async listCases(kind?: CaseKind): Promise<CaseRecord[]> {
    return [...this.cases.values()]
      .filter((c) => !kind || c.kind === kind)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => structuredClone(c));
  }
  async getCase(id: string): Promise<CaseRecord | null> {
    const c = this.cases.get(id);
    return c ? structuredClone(c) : null;
  }
  async countCases(): Promise<number> {
    return this.cases.size;
  }
  async createCase(kind: CaseKind, subjectName: string, data: CaseData): Promise<CaseRecord> {
    const now = new Date().toISOString();
    const c: CaseRecord = { id: randomUUID(), kind, subject_name: subjectName, data: structuredClone(data), created_at: now, updated_at: now };
    this.cases.set(c.id, c);
    return structuredClone(c);
  }
  async updateCase(id: string, subjectName: string, data: CaseData): Promise<CaseRecord | null> {
    const c = this.cases.get(id);
    if (!c) return null;
    c.subject_name = subjectName;
    c.data = structuredClone(data);
    c.updated_at = new Date().toISOString();
    return structuredClone(c);
  }
  async deleteCase(id: string): Promise<boolean> {
    for (const r of [...this.requests.values()]) {
      if (r.case_id === id) {
        this.requests.delete(r.id);
        for (const f of [...this.files.values()]) if (f.request_id === r.id) this.files.delete(f.id);
      }
    }
    return this.cases.delete(id);
  }
  async listRequests(filter?: { caseId?: string; status?: string[] }): Promise<VerificationRequest[]> {
    return [...this.requests.values()]
      .filter((r) => (!filter?.caseId || r.case_id === filter.caseId) && (!filter?.status?.length || filter.status.includes(r.status)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => structuredClone(r));
  }
  async getRequest(id: string): Promise<VerificationRequest | null> {
    const r = this.requests.get(id);
    return r ? structuredClone(r) : null;
  }
  async findRequestByTokenHash(hash: string): Promise<VerificationRequest | null> {
    const r = [...this.requests.values()].find((x) => x.token_hash === hash);
    return r ? structuredClone(r) : null;
  }
  async insertRequest(r: VerificationRequest): Promise<void> {
    this.requests.set(r.id, structuredClone(r));
  }
  async saveRequest(r: VerificationRequest): Promise<void> {
    this.requests.set(r.id, structuredClone(r));
  }
  async putFile(f: Omit<StoredFile, 'created_at'>): Promise<void> {
    this.files.set(f.id, { ...f, created_at: new Date().toISOString() });
  }
  async getFile(id: string): Promise<StoredFile | null> {
    return this.files.get(id) ?? null;
  }
  async deleteFilesForTask(requestId: string, taskId: string): Promise<void> {
    for (const f of [...this.files.values()]) if (f.request_id === requestId && f.task_id === taskId) this.files.delete(f.id);
  }
  async deleteAll(): Promise<void> {
    this.cases.clear();
    this.requests.clear();
    this.files.clear();
  }
}

export const store: Store = pgPool ? new PgStore(pgPool) : new MemoryStore();
