import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Local credentials store (db/cred.sqlite).
 * Uses Node's built-in SQLite module, so no extra dependency is needed.
 */
const DB_PATH = path.resolve(__dirname, '..', 'db', 'cred.sqlite');

const db = new DatabaseSync(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS aws_credentials (
        profile           TEXT PRIMARY KEY,
        access_key_id     TEXT NOT NULL,
        secret_access_key TEXT NOT NULL,
        session_token     TEXT,
        region            TEXT NOT NULL,
        account_id        TEXT,
        arn               TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

export interface AwsCredentialRow {
    profile: string;
    access_key_id: string;
    secret_access_key: string;
    session_token: string | null;
    region: string;
    account_id: string | null;
    arn: string | null;
    created_at: string;
}

/** Insert or replace the credentials for a profile. */
export function saveAwsCredentials(row: Omit<AwsCredentialRow, 'created_at'>): void {
    db.prepare(`
        INSERT OR REPLACE INTO aws_credentials
            (profile, access_key_id, secret_access_key, session_token, region, account_id, arn)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.profile,
        row.access_key_id,
        row.secret_access_key,
        row.session_token,
        row.region,
        row.account_id,
        row.arn,
    );
}

export function getAwsCredentials(profile: string): AwsCredentialRow | undefined {
    return db.prepare('SELECT * FROM aws_credentials WHERE profile = ?')
        .get(profile) as AwsCredentialRow | undefined;
}

export function listAwsCredentials(): AwsCredentialRow[] {
    return db.prepare('SELECT * FROM aws_credentials ORDER BY profile')
        .all() as unknown as AwsCredentialRow[];
}

/** Delete one profile. Returns true if something was deleted. */
export function deleteAwsCredentials(profile: string): boolean {
    const result = db.prepare('DELETE FROM aws_credentials WHERE profile = ?').run(profile);
    return Number(result.changes) > 0;
}

/** Delete every stored profile. Returns how many were deleted. */
export function deleteAllAwsCredentials(): number {
    const result = db.prepare('DELETE FROM aws_credentials').run();
    return Number(result.changes);
}
