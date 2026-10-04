import { gcpList, gcpRequest, pollUntil, type GcpClient } from '../gcp';
import { loadCode } from '../aws-services/zip';

/**
 * Cloud Functions (2nd gen): create, read, update (configuration and source), delete, plus invoke.
 */

const API = 'https://cloudfunctions.googleapis.com/v2';

export interface FunctionsLocation {
    project: string;
    region: string;
}

function functionsUrl({ project, region }: FunctionsLocation, name?: string): string {
    const base = `${API}/projects/${project}/locations/${region}/functions`;
    return name ? `${base}/${name}` : base;
}

/** A long-running operation, as returned by create, update and delete. */
export interface Operation {
    name: string;
    done?: boolean;
    error?: { message?: string };
}

interface CloudFunction {
    name: string;
    description?: string;
    state?: string;
    updateTime?: string;
    url?: string;
    labels?: Record<string, string>;
    buildConfig?: { runtime?: string; entryPoint?: string };
    serviceConfig?: {
        availableMemory?: string;
        timeoutSeconds?: number;
        environmentVariables?: Record<string, string>;
        serviceAccountEmail?: string;
        uri?: string;
    };
}

export interface FunctionSummary {
    name: string;
    runtime?: string;
    entryPoint?: string;
    memory?: string;
    timeoutSec?: number;
    state?: string;
    updated?: string;
    serviceAccount?: string;
    description?: string;
    environment?: Record<string, string>;
    labels?: Record<string, string>;
    uri?: string;
}

function summarize(fn: CloudFunction): FunctionSummary {
    return {
        name: fn.name.split('/').pop() ?? fn.name,
        runtime: fn.buildConfig?.runtime,
        entryPoint: fn.buildConfig?.entryPoint,
        memory: fn.serviceConfig?.availableMemory,
        timeoutSec: fn.serviceConfig?.timeoutSeconds,
        state: fn.state,
        updated: fn.updateTime,
        serviceAccount: fn.serviceConfig?.serviceAccountEmail,
        description: fn.description,
        environment: fn.serviceConfig?.environmentVariables,
        labels: fn.labels,
        uri: fn.serviceConfig?.uri ?? fn.url,
    };
}

/** Zips `source` (a .zip is used as is), uploads it to a signed URL and returns the storageSource to build from. */
async function uploadSource(client: GcpClient, where: FunctionsLocation, source: string): Promise<unknown> {
    const { uploadUrl, storageSource } = await gcpRequest<{ uploadUrl: string; storageSource: unknown }>(
        client, `${functionsUrl(where)}:generateUploadUrl`, { method: 'POST', data: {} },
    );
    // The signed URL carries its own authorization.
    const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(loadCode(source)) });
    if (!res.ok) throw new Error(`Uploading ${source} failed: ${res.status} ${await res.text()}`);
    return storageSource;
}

const memory = (mb: number | undefined) => (mb === undefined ? undefined : `${mb}M`);

export interface FunctionCreateOptions {
    /** A .zip file, or a file/folder that is zipped automatically. */
    source: string;
    runtime: string;
    entryPoint?: string;
    memory?: number;
    timeout?: number;
    description?: string;
    environment?: Record<string, string>;
    labels?: Record<string, string>;
}

export async function createFunction(client: GcpClient, where: FunctionsLocation, name: string, opts: FunctionCreateOptions): Promise<Operation> {
    const storageSource = await uploadSource(client, where, opts.source);
    return gcpRequest<Operation>(client, functionsUrl(where), {
        method: 'POST',
        params: { functionId: name },
        data: {
            description: opts.description,
            labels: opts.labels,
            buildConfig: { runtime: opts.runtime, entryPoint: opts.entryPoint, source: { storageSource } },
            serviceConfig: { availableMemory: memory(opts.memory), timeoutSeconds: opts.timeout, environmentVariables: opts.environment },
        },
    });
}

export async function listFunctions(client: GcpClient, where: FunctionsLocation): Promise<FunctionSummary[]> {
    return (await gcpList<CloudFunction>(client, functionsUrl(where), 'functions')).map(summarize);
}

export async function getFunction(client: GcpClient, where: FunctionsLocation, name: string): Promise<FunctionSummary> {
    return summarize(await gcpRequest<CloudFunction>(client, functionsUrl(where, name)));
}

/** The updateMask paths of the fields that are set, e.g. 'serviceConfig.timeoutSeconds'. */
function given(prefix: string, obj: object): string[] {
    return Object.entries(obj).filter(([, v]) => v !== undefined).map(([k]) => prefix + k);
}

export interface FunctionUpdateOptions {
    source?: string;
    runtime?: string;
    entryPoint?: string;
    memory?: number;
    timeout?: number;
    description?: string;
    /** Merged into the current variables. */
    environment?: Record<string, string>;
    removeEnvironment?: string[];
    /** Merged into the current labels. */
    labels?: Record<string, string>;
}

/** PATCHes only the fields given. Returns the operation, or null when there is nothing to change. */
export async function updateFunction(client: GcpClient, where: FunctionsLocation, name: string, opts: FunctionUpdateOptions): Promise<Operation | null> {
    const changesEnv = opts.environment !== undefined || opts.removeEnvironment !== undefined;
    const changesLabels = opts.labels !== undefined && Object.keys(opts.labels).length > 0;
    // The API replaces the whole map, so start from the current one.
    const current = changesEnv || changesLabels ? await getFunction(client, where, name) : undefined;
    let environment: Record<string, string> | undefined;
    if (changesEnv) {
        environment = { ...current?.environment, ...opts.environment };
        for (const key of opts.removeEnvironment ?? []) delete environment[key];
    }

    const buildConfig = {
        runtime: opts.runtime,
        entryPoint: opts.entryPoint,
        source: opts.source ? { storageSource: await uploadSource(client, where, opts.source) } : undefined,
    };
    const serviceConfig = { availableMemory: memory(opts.memory), timeoutSeconds: opts.timeout, environmentVariables: environment };
    const data = { description: opts.description, labels: changesLabels ? { ...current?.labels, ...opts.labels } : undefined, buildConfig, serviceConfig };
    const mask = [...given('', { description: data.description, labels: data.labels }), ...given('buildConfig.', buildConfig), ...given('serviceConfig.', serviceConfig)];
    if (mask.length === 0) return null;
    return gcpRequest<Operation>(client, functionsUrl(where, name), { method: 'PATCH', params: { updateMask: mask.join(',') }, data });
}

export async function deleteFunction(client: GcpClient, where: FunctionsLocation, name: string): Promise<Operation> {
    return gcpRequest<Operation>(client, functionsUrl(where, name), { method: 'DELETE' });
}

/** Polls a long-running operation until it is done; throws its error if it failed. */
export async function waitForOperation(client: GcpClient, op: Operation, intervalMs?: number): Promise<void> {
    await pollUntil(async () => {
        const current = await gcpRequest<Operation>(client, `${API}/${op.name}`);
        if (current.error) throw new Error(current.error.message ?? `Operation ${op.name} failed.`);
        return current.done === true;
    }, `operation ${op.name}`, intervalMs);
}

/**
 * POSTs `payload` as JSON to the function's URL and returns the response body (JSON parsed, else text).
 * ponytail: sends the client's access token; a private function that only accepts ID tokens answers 401.
 */
export async function invokeFunction(client: GcpClient, where: FunctionsLocation, name: string, payload?: unknown): Promise<unknown> {
    const { uri } = await getFunction(client, where, name);
    if (!uri) throw new Error(`Function ${name} has no URL yet.`);
    return gcpRequest<unknown>(client, uri, { method: 'POST', data: payload });
}
