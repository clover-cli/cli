import { gcpRequest, pollUntil, type GcpClient } from '../gcp';

/**
 * Compute Engine instances: create, read, update, delete, plus start/stop/reset.
 * Every function takes the client, so tests can pass a fake one.
 */

const API = 'https://compute.googleapis.com/compute/v1/projects';

/** Where an instance lives. */
export interface ZoneRef {
    project: string;
    zone: string;
}

const instanceUrl = ({ project, zone }: ZoneRef, name = '') => `${API}/${project}/zones/${zone}/instances${name && `/${name}`}`;

/** Shorthands for --image: image families, so they always point at the latest image. */
export const IMAGE_ALIASES: Record<string, string> = {
    'debian-12': 'projects/debian-cloud/global/images/family/debian-12',
    'debian-12-arm64': 'projects/debian-cloud/global/images/family/debian-12-arm64',
    'ubuntu-24.04': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64',
    'ubuntu-24.04-arm64': 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-arm64',
};

export interface Operation {
    name: string;
    status?: string;
    error?: { errors?: { message?: string }[] };
}

interface Instance {
    name: string;
    zone?: string;
    machineType?: string;
    status?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    labelFingerprint?: string;
    networkInterfaces?: { networkIP?: string; accessConfigs?: { natIP?: string }[] }[];
}

export interface ComputeSummary {
    name: string;
    zone?: string;
    machineType?: string;
    status?: string;
    publicIp?: string;
    privateIp?: string;
    created?: string;
    labels: Record<string, string>;
}

/** The last segment of a resource URL, e.g. the zone name. */
const last = (url?: string) => url?.split('/').pop();

function summarize(i: Instance): ComputeSummary {
    const nic = i.networkInterfaces?.[0];
    return {
        name: i.name,
        zone: last(i.zone),
        machineType: last(i.machineType),
        status: i.status,
        publicIp: nic?.accessConfigs?.[0]?.natIP,
        privateIp: nic?.networkIP,
        created: i.creationTimestamp,
        labels: i.labels ?? {},
    };
}

/** Waits until a zone operation is DONE; throws its error if it failed. */
export async function waitForOperation(client: GcpClient, ref: ZoneRef, op: Operation): Promise<void> {
    let current = op;
    await pollUntil(async () => {
        current = await gcpRequest<Operation>(client, `${API}/${ref.project}/zones/${ref.zone}/operations/${op.name}`);
        return current.status === 'DONE';
    }, `operation ${op.name}`);
    const errors = current.error?.errors?.map((e) => e.message).join('; ');
    if (errors) throw new Error(errors);
}

export interface ComputeCreateOptions {
    name: string;
    machineType: string;
    image: string;
    diskSize?: number;
    startupScript?: string;
    /** Defaults to true, like gcloud. */
    publicIp?: boolean;
    labels?: Record<string, string>;
}

export async function createInstance(client: GcpClient, ref: ZoneRef, opts: ComputeCreateOptions): Promise<Operation> {
    return gcpRequest<Operation>(client, instanceUrl(ref), {
        method: 'POST',
        data: {
            name: opts.name,
            machineType: `zones/${ref.zone}/machineTypes/${opts.machineType}`,
            labels: opts.labels,
            disks: [{
                boot: true,
                autoDelete: true,
                initializeParams: { sourceImage: IMAGE_ALIASES[opts.image] ?? opts.image, diskSizeGb: opts.diskSize },
            }],
            networkInterfaces: [{
                network: 'global/networks/default',
                accessConfigs: opts.publicIp === false ? [] : [{ type: 'ONE_TO_ONE_NAT', name: 'External NAT' }],
            }],
            metadata: opts.startupScript ? { items: [{ key: 'startup-script', value: opts.startupScript }] } : undefined,
        },
    });
}

export interface ComputeListOptions {
    statuses?: string[];
    labels?: Record<string, string>;
}

/** Instances in every zone of the project. */
export async function listInstances(client: GcpClient, project: string, opts: ComputeListOptions = {}): Promise<ComputeSummary[]> {
    const instances: Instance[] = [];
    let pageToken: string | undefined;
    do {
        const page = await gcpRequest<{ items?: Record<string, { instances?: Instance[] }>; nextPageToken?: string }>(
            client, `${API}/${project}/aggregated/instances`, { params: { pageToken } });
        for (const scope of Object.values(page.items ?? {})) instances.push(...(scope.instances ?? []));
        pageToken = page.nextPageToken;
    } while (pageToken);

    const statuses = opts.statuses?.map((s) => s.toUpperCase());
    return instances
        .filter((i) => !statuses?.length || statuses.includes(i.status ?? ''))
        .filter((i) => Object.entries(opts.labels ?? {}).every(([k, v]) => i.labels?.[k] === v))
        .map(summarize);
}

export async function getInstance(client: GcpClient, ref: ZoneRef, name: string): Promise<ComputeSummary> {
    return summarize(await gcpRequest<Instance>(client, instanceUrl(ref, name)));
}

/** POSTs an instance method (start, stop, reset, setLabels, ...) and returns its operation. */
export async function instanceOp(client: GcpClient, ref: ZoneRef, name: string, method: string, opts: { data?: unknown; params?: Record<string, boolean> } = {}): Promise<Operation> {
    return gcpRequest<Operation>(client, `${instanceUrl(ref, name)}/${method}`, { method: 'POST', ...opts });
}

export async function deleteInstance(client: GcpClient, ref: ZoneRef, name: string, { force = false } = {}): Promise<Operation> {
    if (force) {
        await waitForOperation(client, ref, await instanceOp(client, ref, name, 'setDeletionProtection', { params: { deletionProtection: false } }));
    }
    return gcpRequest<Operation>(client, instanceUrl(ref, name), { method: 'DELETE' });
}

export interface ComputeUpdateOptions {
    machineType?: string;
    /** Stop the instance first if needed to change its machine type, then start it again. */
    restart?: boolean;
    labels?: Record<string, string>;
    removeLabels?: string[];
    deletionProtection?: boolean;
    onProgress?: (message: string) => void;
}

/** Applies each change and waits for it, so the returned instance reflects them all. */
export async function updateInstance(client: GcpClient, ref: ZoneRef, name: string, opts: ComputeUpdateOptions): Promise<ComputeSummary> {
    const progress = opts.onProgress ?? (() => {});
    const run = async (method: string, body: { data?: unknown; params?: Record<string, boolean> } = {}) =>
        waitForOperation(client, ref, await instanceOp(client, ref, name, method, body));

    const current = await gcpRequest<Instance>(client, instanceUrl(ref, name));
    // A stopped instance is TERMINATED in GCP. Check before applying anything so nothing is half-updated.
    const running = current.status !== 'TERMINATED';
    if (opts.machineType && running && !opts.restart) {
        throw new Error(`Instance ${name} is ${current.status}. Stop it first, or pass --restart to stop, resize and start it.`);
    }

    if (Object.keys(opts.labels ?? {}).length || opts.removeLabels?.length) {
        const labels = Object.fromEntries(Object.entries({ ...current.labels, ...opts.labels })
            .filter(([k]) => !opts.removeLabels?.includes(k)));
        await run('setLabels', { data: { labels, labelFingerprint: current.labelFingerprint } });
    }
    if (opts.deletionProtection !== undefined) {
        await run('setDeletionProtection', { params: { deletionProtection: opts.deletionProtection } });
    }
    if (opts.machineType) {
        if (running) {
            progress(`Stopping ${name}...`);
            await run('stop');
        }
        progress(`Changing ${name} to ${opts.machineType}...`);
        await run('setMachineType', { data: { machineType: `zones/${ref.zone}/machineTypes/${opts.machineType}` } });
        if (running) {
            progress(`Starting ${name}...`);
            await run('start');
        }
    }
    return getInstance(client, ref, name);
}
