// Connection from the user to GCP
import { GoogleAuth } from 'google-auth-library';
import { readGcpEnv, type GcpLogin } from '../credentials';
import type { AwsResource } from './aws';

/**
 * Auth for the GCP REST APIs, from a service account key file or, without one,
 * the Application Default Credentials.
 */
export function gcpAuth(login: GcpLogin): GoogleAuth {
    return new GoogleAuth({
        keyFile: login.keyFile,
        projectId: login.project,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
}

/**
 * Checks the credentials by getting an access token, which needs no IAM permissions.
 * Returns who they belong to; user ADC credentials have no email, so that is null.
 * Throws if the credentials are invalid or missing.
 */
export async function verifyGcpCredentials(login: GcpLogin) {
    const auth = gcpAuth(login);
    await auth.getAccessToken();
    const { client_email: email } = await auth.getCredentials();
    return { email: email ?? null, project: login.project };
}

/** The GCP login from the GOOGLE_* environment variables (see src/credentials.ts). */
export function getGcpConfig(env: NodeJS.ProcessEnv = process.env): GcpLogin {
    const login = readGcpEnv(env);
    if (!login) {
        throw new Error('No GCP project found. Set GOOGLE_CLOUD_PROJECT, or run: eval "$(clover gcp login)"');
    }
    return login;
}

/** What the GCP service modules need from GoogleAuth; tests pass a fake (see fakeGcpClient). */
export type GcpClient = Pick<GoogleAuth, 'request'>;

export function gcpClient(login: GcpLogin): GcpClient {
    return gcpAuth(login);
}

export interface GcpRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    params?: Record<string, string | number | boolean | undefined>;
    data?: unknown;
}

/** Calls a GCP REST API and returns the response body. GCP's error message is thrown as is. */
export async function gcpRequest<T>(client: GcpClient, url: string, opts: GcpRequestOptions = {}): Promise<T> {
    // gaxios types `data` as a union of body types; any JSON-serializable value works.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const res = await client.request<T>({ url, method: opts.method ?? 'GET', params: opts.params, data: opts.data as object });
    return res.data;
}

/** Follows nextPageToken and returns every item under `key` (e.g. 'items', 'instances'). */
export async function gcpList<T>(client: GcpClient, url: string, key: string, params: GcpRequestOptions['params'] = {}): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
        const page = await gcpRequest<Record<string, unknown>>(client, url, { params: { ...params, pageToken } });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        items.push(...((page[key] ?? []) as T[]));
        pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
    } while (pageToken);
    return items;
}

/** How long --wait waits before giving up. */
export const GCP_MAX_WAIT_MS = 30 * 60 * 1000;

/**
 * Calls `check` every `intervalMs` until it returns true; throws after GCP_MAX_WAIT_MS.
 * Used for --wait on long-running operations.
 */
export async function pollUntil(check: () => Promise<boolean>, what: string, intervalMs = 5000): Promise<void> {
    const deadline = Date.now() + GCP_MAX_WAIT_MS;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

/** Every resource in the project from Cloud Asset Inventory, grouped by service (e.g. 'compute'). */
export async function listGcpResources(client: GcpClient, project: string) {
    const results = await gcpList<{ name: string; displayName?: string; assetType: string; state?: string }>(
        client, `https://cloudasset.googleapis.com/v1/projects/${project}:searchAllResources`, 'results');
    const byService = new Map<string, AwsResource[]>();
    for (const r of results) {
        const [api, type] = r.assetType.split('/');
        const service = api.split('.')[0];
        byService.set(service, [...byService.get(service) ?? [], { id: r.name, name: r.displayName, type, state: r.state }]);
    }
    const services = [...byService].map(([service, resources]) => ({ service, count: resources.length, resources }));
    return { project, services, total: results.length };
}
