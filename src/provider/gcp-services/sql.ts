import { gcpList, gcpRequest, pollUntil, type GcpClient } from '../gcp';

/**
 * Cloud SQL instances: create, read, update, delete, plus start/stop/restart.
 * Every change returns a long-running operation; waitForOperation follows it to the end.
 */

const API = 'https://sqladmin.googleapis.com/v1/projects';

interface Instance {
    name: string;
    databaseVersion?: string;
    region?: string;
    state?: string;
    connectionName?: string;
    ipAddresses?: { type?: string; ipAddress?: string }[];
    settings?: {
        tier?: string;
        dataDiskSizeGb?: string;
        activationPolicy?: string;
        deletionProtectionEnabled?: boolean;
        userLabels?: Record<string, string>;
        ipConfiguration?: { ipv4Enabled?: boolean };
    };
}

export interface SqlOperation {
    name: string;
    status?: string;
    operationType?: string;
    error?: { errors?: { code?: string; message?: string }[] };
}

export interface SqlSummary {
    id: string;
    version?: string;
    tier?: string;
    status?: string;
    activation?: string;
    storageGb?: number;
    ip?: string;
    connectionName?: string;
    region?: string;
    public?: boolean;
    deletionProtection?: boolean;
    labels?: Record<string, string>;
}

function summarize(db: Instance): SqlSummary {
    const s = db.settings ?? {};
    return {
        id: db.name,
        version: db.databaseVersion,
        tier: s.tier,
        status: db.state,
        activation: s.activationPolicy,
        storageGb: s.dataDiskSizeGb ? Number(s.dataDiskSizeGb) : undefined,
        ip: db.ipAddresses?.find((a) => a.type === 'PRIMARY')?.ipAddress ?? db.ipAddresses?.[0]?.ipAddress,
        connectionName: db.connectionName,
        region: db.region,
        public: s.ipConfiguration?.ipv4Enabled,
        deletionProtection: s.deletionProtectionEnabled,
        labels: s.userLabels,
    };
}

const instancesUrl = (project: string) => `${API}/${project}/instances`;

export interface SqlCreateOptions {
    databaseVersion: string;
    tier: string;
    region: string;
    storage?: number;
    password: string;
    public?: boolean;
    deletionProtection?: boolean;
    labels?: Record<string, string>;
}

export function createDatabase(client: GcpClient, project: string, id: string, opts: SqlCreateOptions): Promise<SqlOperation> {
    return gcpRequest(client, instancesUrl(project), {
        method: 'POST',
        data: {
            name: id,
            databaseVersion: opts.databaseVersion,
            region: opts.region,
            rootPassword: opts.password,
            settings: {
                tier: opts.tier,
                dataDiskSizeGb: opts.storage === undefined ? undefined : String(opts.storage),
                userLabels: opts.labels,
                ipConfiguration: opts.public === undefined ? undefined : { ipv4Enabled: opts.public },
                deletionProtectionEnabled: opts.deletionProtection,
            },
        },
    });
}

export async function listDatabases(client: GcpClient, project: string): Promise<SqlSummary[]> {
    return (await gcpList<Instance>(client, instancesUrl(project), 'items')).map(summarize);
}

export async function getDatabase(client: GcpClient, project: string, id: string): Promise<SqlSummary> {
    return summarize(await gcpRequest<Instance>(client, `${instancesUrl(project)}/${id}`));
}

export interface SqlUpdateOptions {
    tier?: string;
    /** Can only grow. */
    storage?: number;
    public?: boolean;
    deletionProtection?: boolean;
    /** Added to the existing labels, like AWS tags. */
    labels?: Record<string, string>;
}

/** PATCHes the given settings. Returns null when there is nothing to change. */
export async function updateDatabase(client: GcpClient, project: string, id: string, opts: SqlUpdateOptions): Promise<SqlOperation | null> {
    const settings: Instance['settings'] = {
        tier: opts.tier,
        dataDiskSizeGb: opts.storage === undefined ? undefined : String(opts.storage),
        ipConfiguration: opts.public === undefined ? undefined : { ipv4Enabled: opts.public },
        deletionProtectionEnabled: opts.deletionProtection,
    };
    if (opts.labels && Object.keys(opts.labels).length > 0) {
        // PATCH replaces the whole map, so merge with the current labels.
        const current = await getDatabase(client, project, id);
        settings.userLabels = { ...current.labels, ...opts.labels };
    }
    if (Object.values(settings).every((v) => v === undefined)) return null;
    return patch(client, project, id, settings);
}

function patch(client: GcpClient, project: string, id: string, settings: Instance['settings']): Promise<SqlOperation> {
    return gcpRequest(client, `${instancesUrl(project)}/${id}`, { method: 'PATCH', data: { settings } });
}

/** With force, turns off deletion protection first (and waits for that to apply). */
export async function deleteDatabase(client: GcpClient, project: string, id: string, { force = false } = {}): Promise<SqlOperation> {
    if (force) {
        await waitForOperation(client, project, await patch(client, project, id, { deletionProtectionEnabled: false }));
    }
    return gcpRequest(client, `${instancesUrl(project)}/${id}`, { method: 'DELETE' });
}

export function startDatabase(client: GcpClient, project: string, id: string): Promise<SqlOperation> {
    return patch(client, project, id, { activationPolicy: 'ALWAYS' });
}

export function stopDatabase(client: GcpClient, project: string, id: string): Promise<SqlOperation> {
    return patch(client, project, id, { activationPolicy: 'NEVER' });
}

export function rebootDatabase(client: GcpClient, project: string, id: string): Promise<SqlOperation> {
    return gcpRequest(client, `${instancesUrl(project)}/${id}/restart`, { method: 'POST' });
}

/** Polls the operation until it is DONE; throws GCP's error if it failed. */
export async function waitForOperation(client: GcpClient, project: string, op: SqlOperation): Promise<void> {
    await pollUntil(async () => {
        op = await gcpRequest<SqlOperation>(client, `${API}/${project}/operations/${op.name}`);
        if (op.error) throw new Error(op.error.errors?.map((e) => e.message ?? e.code).join('; ') || `Operation ${op.name} failed.`);
        return op.status === 'DONE';
    }, `operation ${op.name}`);
}
