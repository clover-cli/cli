import { gcpList, gcpRequest, pollUntil, type GcpClient } from '../gcp';

/**
 * Firestore databases (create, read, update, delete) and the documents in them.
 * Documents are plain JSON; they are converted to and from Firestore's typed values here.
 */

const API = 'https://firestore.googleapis.com/v1';

export type Item = Record<string, unknown>;

/** `default` is Firestore's `(default)` database. */
export function databaseId(name: string): string {
    return name === 'default' ? '(default)' : name;
}

function databasePath(project: string, database: string): string {
    return `projects/${project}/databases/${databaseId(database)}`;
}

function documentUrl(project: string, database: string, collection: string, id: string): string {
    return `${API}/${databasePath(project, database)}/documents/${collection}/${encodeURIComponent(id)}`;
}

// ---- Typed values ----

interface Value {
    integerValue?: string;
    mapValue?: { fields?: Record<string, Value> };
    arrayValue?: { values?: Value[] };
    [type: string]: unknown;
}

/** Plain JSON to a Firestore value, e.g. 1 -> { integerValue: '1' }. */
function toValue(value: unknown): Value {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
    if (typeof value === 'object') return { mapValue: { fields: toFields(value) } };
    throw new Error(`Cannot store ${typeof value} in Firestore.`);
}

/** A Firestore value to plain JSON. Timestamps, references and bytes come back as their strings. */
function fromValue(value: Value): unknown {
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.mapValue) return fromFields(value.mapValue.fields);
    if (value.arrayValue) return (value.arrayValue.values ?? []).map(fromValue);
    return Object.values(value)[0];
}

export function toFields(item: object): Record<string, Value> {
    return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toValue(v)]));
}

export function fromFields(fields: Record<string, Value> = {}): Item {
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));
}

// ---- Databases ----

interface Database {
    name: string;
    locationId?: string;
    type?: string;
    deleteProtectionState?: string;
    pointInTimeRecoveryEnablement?: string;
    createTime?: string;
}

export interface Operation {
    name: string;
    done?: boolean;
    error?: { message?: string };
}

export interface DatabaseSummary {
    name: string;
    location?: string;
    type?: string;
    deletionProtection: boolean;
    pointInTimeRecovery: boolean;
    created?: string;
}

function summarize(db: Database): DatabaseSummary {
    return {
        name: db.name.split('/').pop() ?? db.name,
        location: db.locationId,
        type: db.type,
        deletionProtection: db.deleteProtectionState === 'DELETE_PROTECTION_ENABLED',
        pointInTimeRecovery: db.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED',
        created: db.createTime,
    };
}

function protection(enabled: boolean): string {
    return enabled ? 'DELETE_PROTECTION_ENABLED' : 'DELETE_PROTECTION_DISABLED';
}

export interface DatabaseCreateOptions {
    location: string;
    deletionProtection?: boolean;
}

/** Starts creating a Firestore (native mode) database; returns the long-running operation. */
export async function createDatabase(client: GcpClient, project: string, name: string, opts: DatabaseCreateOptions): Promise<Operation> {
    return gcpRequest<Operation>(client, `${API}/projects/${project}/databases`, {
        method: 'POST',
        params: { databaseId: databaseId(name) },
        data: {
            type: 'FIRESTORE_NATIVE',
            locationId: opts.location,
            deleteProtectionState: opts.deletionProtection === undefined ? undefined : protection(opts.deletionProtection),
        },
    });
}

export async function listDatabases(client: GcpClient, project: string): Promise<DatabaseSummary[]> {
    return (await gcpList<Database>(client, `${API}/projects/${project}/databases`, 'databases')).map(summarize);
}

export async function getDatabase(client: GcpClient, project: string, name: string): Promise<DatabaseSummary> {
    return summarize(await gcpRequest<Database>(client, `${API}/${databasePath(project, name)}`));
}

/** Turns deletion protection on or off; returns the operation, or undefined when there is nothing to change. */
export async function updateDatabase(client: GcpClient, project: string, name: string, opts: { deletionProtection?: boolean }): Promise<Operation | undefined> {
    if (opts.deletionProtection === undefined) return undefined;
    return gcpRequest<Operation>(client, `${API}/${databasePath(project, name)}`, {
        method: 'PATCH',
        params: { updateMask: 'deleteProtectionState' },
        data: { deleteProtectionState: protection(opts.deletionProtection) },
    });
}

export async function deleteDatabase(client: GcpClient, project: string, name: string, { force = false } = {}): Promise<Operation> {
    if (force) {
        const op = await updateDatabase(client, project, name, { deletionProtection: false });
        if (op) await waitForOperation(client, op);
    }
    return gcpRequest<Operation>(client, `${API}/${databasePath(project, name)}`, { method: 'DELETE' });
}

/** Polls a long-running operation until it is done; throws its error if it failed. */
export async function waitForOperation(client: GcpClient, op: Operation): Promise<void> {
    let current = op;
    await pollUntil(async () => {
        if (!current.done) current = await gcpRequest<Operation>(client, `${API}/${op.name}`);
        return current.done === true;
    }, `operation ${op.name}`);
    if (current.error) throw new Error(current.error.message ?? `Operation ${op.name} failed.`);
}

// ---- Documents ----

interface Document {
    name: string;
    fields?: Record<string, Value>;
}

function isNotFound(err: unknown): boolean {
    return err instanceof Error && 'response' in err && typeof err.response === 'object' && err.response !== null
        && 'status' in err.response && err.response.status === 404;
}

/** Creates or replaces a document. */
export async function putItem(client: GcpClient, project: string, database: string, collection: string, id: string, item: Item): Promise<void> {
    await gcpRequest(client, documentUrl(project, database, collection, id), { method: 'PATCH', data: { fields: toFields(item) } });
}

export async function getItem(client: GcpClient, project: string, database: string, collection: string, id: string): Promise<Item | undefined> {
    try {
        const doc = await gcpRequest<Document>(client, documentUrl(project, database, collection, id));
        return fromFields(doc.fields);
    } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
    }
}

/** Deletes a document; returns false if there was no such document. */
export async function deleteItem(client: GcpClient, project: string, database: string, collection: string, id: string): Promise<boolean> {
    try {
        await gcpRequest(client, documentUrl(project, database, collection, id), {
            method: 'DELETE',
            params: { 'currentDocument.exists': true },
        });
        return true;
    } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
    }
}

/** Reads up to `limit` documents (all of them when no limit is given), each with its `id`. */
export async function scanItems(client: GcpClient, project: string, database: string, collection: string, { limit }: { limit?: number } = {}): Promise<Item[]> {
    const url = `${API}/${databasePath(project, database)}/documents/${collection}`;
    // ponytail: one page of `limit` docs; Firestore rarely returns fewer, follow nextPageToken if it matters.
    const docs = limit
        ? (await gcpRequest<{ documents?: Document[] }>(client, url, { params: { pageSize: limit } })).documents ?? []
        : await gcpList<Document>(client, url, 'documents');
    return docs.map((doc) => ({ id: doc.name.split('/').pop(), ...fromFields(doc.fields) }));
}
