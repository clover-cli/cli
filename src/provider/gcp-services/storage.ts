import { readFile, writeFile } from 'node:fs/promises';
import { gcpList, gcpRequest, type GcpClient } from '../gcp';

/**
 * Cloud Storage buckets (create, read, update, delete) and the objects in them.
 */

const API = 'https://storage.googleapis.com/storage/v1/b';

interface GcsBucket {
    name: string;
    location?: string;
    storageClass?: string;
    timeCreated?: string;
    versioning?: { enabled?: boolean };
    labels?: Record<string, string>;
}

interface GcsObject {
    name: string;
    generation?: string;
    size?: string;
    updated?: string;
}

export interface BucketSummary {
    name: string;
    location?: string;
    storageClass?: string;
    versioning: boolean;
    created?: string;
    labels?: Record<string, string>;
}

function toSummary(b: GcsBucket): BucketSummary {
    return {
        name: b.name,
        location: b.location,
        storageClass: b.storageClass,
        versioning: b.versioning?.enabled ?? false,
        created: b.timeCreated,
        labels: b.labels,
    };
}

function objectUrl(bucket: string, key: string): string {
    return `${API}/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`;
}

export interface BucketCreateOptions {
    location: string;
    versioning?: boolean;
    labels?: Record<string, string>;
}

export async function createBucket(client: GcpClient, project: string, name: string, opts: BucketCreateOptions): Promise<BucketSummary> {
    const bucket = await gcpRequest<GcsBucket>(client, API, {
        method: 'POST',
        params: { project },
        data: { name, location: opts.location, versioning: opts.versioning ? { enabled: true } : undefined, labels: opts.labels },
    });
    return toSummary(bucket);
}

export async function listBuckets(client: GcpClient, project: string): Promise<BucketSummary[]> {
    return (await gcpList<GcsBucket>(client, API, 'items', { project })).map(toSummary);
}

export async function getBucket(client: GcpClient, name: string): Promise<BucketSummary> {
    return toSummary(await gcpRequest<GcsBucket>(client, `${API}/${encodeURIComponent(name)}`));
}

export interface BucketUpdateOptions {
    versioning?: boolean;
    /** Added to (or overwriting) the bucket's existing labels. */
    labels?: Record<string, string>;
    removeLabels?: string[];
}

export async function updateBucket(client: GcpClient, name: string, opts: BucketUpdateOptions): Promise<BucketSummary> {
    // PATCH merges labels; a null value removes that label.
    const labels: Record<string, string | null> = { ...opts.labels };
    for (const key of opts.removeLabels ?? []) labels[key] = null;
    const bucket = await gcpRequest<GcsBucket>(client, `${API}/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        data: {
            versioning: opts.versioning === undefined ? undefined : { enabled: opts.versioning },
            labels: Object.keys(labels).length > 0 ? labels : undefined,
        },
    });
    return toSummary(bucket);
}

/** Deletes every object and every noncurrent version in the bucket. Returns how many were deleted. */
export async function emptyBucket(client: GcpClient, name: string): Promise<number> {
    const objects = await gcpList<GcsObject>(client, `${API}/${encodeURIComponent(name)}/o`, 'items', { versions: true });
    // ponytail: one DELETE per object, sequential; batch requests if buckets get big.
    for (const o of objects) {
        await gcpRequest(client, objectUrl(name, o.name), { method: 'DELETE', params: { generation: o.generation } });
    }
    return objects.length;
}

/** Cloud Storage refuses to delete a bucket that has objects in it; with `force`, it is emptied first. */
export async function deleteBucket(client: GcpClient, name: string, { force = false } = {}): Promise<{ name: string; objectsDeleted: number }> {
    const objectsDeleted = force ? await emptyBucket(client, name) : 0;
    await gcpRequest(client, `${API}/${encodeURIComponent(name)}`, { method: 'DELETE' });
    return { name, objectsDeleted };
}

// ---- Objects ----

export interface ObjectSummary {
    key: string;
    size?: number;
    modified?: string;
}

export async function listObjects(client: GcpClient, bucket: string, { prefix }: { prefix?: string } = {}): Promise<ObjectSummary[]> {
    const objects = await gcpList<GcsObject>(client, `${API}/${encodeURIComponent(bucket)}/o`, 'items', { prefix });
    return objects.map((o) => ({ key: o.name, size: o.size === undefined ? undefined : Number(o.size), modified: o.updated }));
}

export async function uploadObject(
    client: GcpClient, bucket: string, key: string, file: string, { contentType }: { contentType?: string } = {},
): Promise<{ bucket: string; key: string; size: number; generation?: string }> {
    const body = await readFile(file);
    // gcpRequest can't set headers, and the upload API needs the object's Content-Type.
    const res = await client.request<GcsObject>({
        url: `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`,
        method: 'POST',
        params: { uploadType: 'media', name: key },
        headers: { 'Content-Type': contentType ?? 'application/octet-stream' },
        data: body,
    });
    return { bucket, key, size: body.length, generation: res.data.generation };
}

export async function downloadObject(client: GcpClient, bucket: string, key: string, file: string): Promise<{ bucket: string; key: string; file: string }> {
    const res = await client.request<ArrayBuffer>({ url: objectUrl(bucket, key), params: { alt: 'media' }, responseType: 'arraybuffer' });
    await writeFile(file, Buffer.from(res.data));
    return { bucket, key, file };
}

export async function deleteObject(client: GcpClient, bucket: string, key: string): Promise<void> {
    await gcpRequest(client, objectUrl(bucket, key), { method: 'DELETE' });
}
