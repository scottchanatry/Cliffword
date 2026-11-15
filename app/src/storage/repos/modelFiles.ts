/**
 * Language model files on the device (the GGUF the app downloads), with their download and
 * check state. `path` is where the file lives in the app's document directory.
 */
import type { StorageClock } from '../clock';
import type { SqlDatabase } from '../sql/types';

/** missing: known but not on the device; verifying: downloaded, checksum running. */
export type ModelFileStatus = 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed';
export const MODEL_FILE_STATUSES: readonly ModelFileStatus[] = ['missing', 'downloading', 'verifying', 'ready', 'failed'];

export interface ModelFile {
  /** Stable model id, e.g. "qwen3-1.7b-q4_k_m". */
  id: string;
  path: string;
  /** Bytes on disk so far (the full size once ready). */
  bytes: number;
  /** Expected or verified SHA-256 (hex), when known. */
  sha256: string | null;
  status: ModelFileStatus;
  updatedAt: number;
}

export type ModelFileInput = Omit<ModelFile, 'updatedAt' | 'bytes' | 'sha256'> &
  Partial<Pick<ModelFile, 'updatedAt' | 'bytes' | 'sha256'>>;

interface ModelFileRow {
  id: string;
  path: string;
  bytes: number;
  sha256: string | null;
  status: string;
  updated_at: number;
}

const toModelFile = (row: ModelFileRow): ModelFile => ({
  id: row.id,
  path: row.path,
  bytes: row.bytes,
  sha256: row.sha256,
  status: row.status as ModelFileStatus,
  updatedAt: row.updated_at,
});

function checkStatus(status: ModelFileStatus): void {
  if (!MODEL_FILE_STATUSES.includes(status)) throw new Error(`Unknown model file status: ${String(status)}`);
}

export class ModelFileRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  async upsert(input: ModelFileInput): Promise<ModelFile> {
    checkStatus(input.status);
    const file: ModelFile = {
      id: input.id,
      path: input.path,
      bytes: input.bytes ?? 0,
      sha256: input.sha256 ?? null,
      status: input.status,
      updatedAt: input.updatedAt ?? this.clock.now(),
    };
    await this.db.run(
      `INSERT INTO model_files (id, path, bytes, sha256, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, sha256 = excluded.sha256,
         status = excluded.status, updated_at = excluded.updated_at`,
      [file.id, file.path, file.bytes, file.sha256, file.status, file.updatedAt],
    );
    return file;
  }

  async get(id: string): Promise<ModelFile | null> {
    const row = await this.db.get<ModelFileRow>('SELECT * FROM model_files WHERE id = ?', [id]);
    return row ? toModelFile(row) : null;
  }

  async list(): Promise<ModelFile[]> {
    const rows = await this.db.all<ModelFileRow>('SELECT * FROM model_files ORDER BY id');
    return rows.map(toModelFile);
  }

  /** Change the status (and optionally size and checksum) of a known file. Returns it, or null. */
  async setStatus(
    id: string,
    status: ModelFileStatus,
    patch: { bytes?: number; sha256?: string | null; at?: number } = {},
  ): Promise<ModelFile | null> {
    checkStatus(status);
    const result = await this.db.run(
      `UPDATE model_files SET status = ?, bytes = COALESCE(?, bytes),
         sha256 = CASE WHEN ? THEN ? ELSE sha256 END, updated_at = ? WHERE id = ?`,
      [status, patch.bytes ?? null, patch.sha256 !== undefined ? 1 : 0, patch.sha256 ?? null, patch.at ?? this.clock.now(), id],
    );
    return result.changes > 0 ? this.get(id) : null;
  }

  async remove(id: string): Promise<void> {
    await this.db.run('DELETE FROM model_files WHERE id = ?', [id]);
  }
}
