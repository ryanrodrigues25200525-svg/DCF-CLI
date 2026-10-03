export interface CompanyRecord {
  ticker: string;
  route: string | null;
  currency: string | null;
  unit_scale: string | null;
  accession: string | null;
  filed_date: string | null;
  workbook_hash: string | null;
  built_at: string | null;
  readiness: string | null;
  workbook_path: string | null;
  revision_id: string | null;
}

export interface RevisionRecord {
  id: string;
  ticker: string;
  workbook_hash: string;
  parent_hash: string | null;
  created_at: string;
  path: string | null;
  note: string | null;
}

export interface ProposalRecord {
  id: string;
  ticker: string;
  base_revision_hash: string | null;
  status: string;
  created_at: string;
  payload_json: string;
}

/** A staged build/update awaiting AI verification and human approval. */
export interface CandidateRecord {
  id: string;
  ticker: string;
  workbook_hash: string;
  base_revision_hash: string | null;
  status: string;
  created_at: string;
  payload_json: string;
}

export interface SnapshotRecord {
  ticker: string;
  accession: string;
  filed_date: string | null;
  fetched_at: string;
  payload_json: string;
}

export interface WatchRecord {
  ticker: string;
  enabled: number;
  last_check: string | null;
  latest_accession: string | null;
  update_ready: number;
  last_error: string | null;
}

export interface AddRevisionInput {
  ticker: string;
  workbook_hash: string;
  parent_hash?: string | null;
  path?: string | null;
  note?: string | null;
  id?: string;
}

export interface CreateProposalInput {
  ticker: string;
  base_revision_hash?: string | null;
  payload?: unknown;
  payload_json?: string;
  id?: string;
  status?: string;
}

export interface CreateCandidateInput {
  ticker: string;
  workbook_hash: string;
  base_revision_hash?: string | null;
  payload?: unknown;
  payload_json?: string;
  id?: string;
  status?: string;
}

export interface SaveSnapshotInput {
  ticker: string;
  accession: string;
  filed_date?: string | null;
  payload?: unknown;
  payload_json?: string;
  fetched_at?: string;
}

export interface WatchPatch {
  enabled?: number | boolean;
  last_check?: string | null;
  latest_accession?: string | null;
  update_ready?: number | boolean;
  last_error?: string | null;
}
