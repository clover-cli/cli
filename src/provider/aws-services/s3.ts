import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
    CreateBucketCommand,
    DeleteBucketCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetBucketLocationCommand,
    GetBucketTaggingCommand,
    GetBucketVersioningCommand,
    GetObjectCommand,
    ListBucketsCommand,
    ListObjectsV2Command,
    ListObjectVersionsCommand,
    PutBucketTaggingCommand,
    PutBucketVersioningCommand,
    PutObjectCommand,
    S3Client,
    waitUntilBucketExists,
    waitUntilBucketNotExists,
    type BucketLocationConstraint,
    type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import type { AwsClientConfig } from '../aws';
import { MAX_WAIT_SECONDS, toTagList } from './common';

/**
 * S3 buckets (create, read, update, delete) and the objects in them.
 */

export function s3Client(config: AwsClientConfig): S3Client {
    // Buckets live in one region each; follow redirects so any bucket works from any --region.
    return new S3Client({ ...config, followRegionRedirects: true });
}

export interface BucketSummary {
    name: string;
    region?: string;
    versioning?: string;
    created?: string;
    tags?: Record<string, string>;
}

export interface BucketCreateOptions {
    region: string;
    versioning?: boolean;
    tags?: Record<string, string>;
}

export async function createBucket(client: S3Client, name: string, opts: BucketCreateOptions): Promise<BucketSummary> {
    await client.send(new CreateBucketCommand({
        Bucket: name,
        // us-east-1 is the default location and must not be given explicitly.
        CreateBucketConfiguration: opts.region === 'us-east-1'
            ? undefined
            // Any region string is passed through; AWS validates it, even ones newer than the SDK's list.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            : { LocationConstraint: opts.region as BucketLocationConstraint },
    }));
    if (opts.versioning || opts.tags) {
        await waitForBucket(client, name, 'exists');
        await updateBucket(client, name, { versioning: opts.versioning, tags: opts.tags });
    }
    return { name, region: opts.region, versioning: opts.versioning ? 'Enabled' : undefined, tags: opts.tags };
}

/** Buckets are global: this lists every bucket in the account, whatever the region. */
export async function listBuckets(client: S3Client): Promise<BucketSummary[]> {
    const buckets: BucketSummary[] = [];
    let token: string | undefined;
    do {
        const page = await client.send(new ListBucketsCommand({ ContinuationToken: token }));
        for (const b of page.Buckets ?? []) {
            buckets.push({ name: b.Name ?? 'unknown', region: b.BucketRegion, created: b.CreationDate?.toISOString() });
        }
        token = page.ContinuationToken;
    } while (token);
    return buckets;
}

async function getTags(client: S3Client, name: string): Promise<Record<string, string>> {
    try {
        const result = await client.send(new GetBucketTaggingCommand({ Bucket: name }));
        return Object.fromEntries((result.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
    } catch (err) {
        if (err instanceof Error && err.name === 'NoSuchTagSet') return {};
        throw err;
    }
}

export async function getBucket(client: S3Client, name: string): Promise<BucketSummary> {
    const [location, versioning, tags] = await Promise.all([
        client.send(new GetBucketLocationCommand({ Bucket: name })),
        client.send(new GetBucketVersioningCommand({ Bucket: name })),
        getTags(client, name),
    ]);
    return {
        name,
        // An empty location means us-east-1.
        region: location.LocationConstraint || 'us-east-1',
        versioning: versioning.Status ?? 'Disabled',
        tags,
    };
}

export interface BucketUpdateOptions {
    /** true enables versioning, false suspends it (S3 can't fully disable it once on). */
    versioning?: boolean;
    /** Added to (or overwriting) the bucket's existing tags. */
    tags?: Record<string, string>;
    removeTags?: string[];
}

export async function updateBucket(client: S3Client, name: string, opts: BucketUpdateOptions): Promise<BucketSummary> {
    if (opts.versioning !== undefined) {
        await client.send(new PutBucketVersioningCommand({
            Bucket: name,
            VersioningConfiguration: { Status: opts.versioning ? 'Enabled' : 'Suspended' },
        }));
    }
    if (opts.tags || opts.removeTags) {
        // PutBucketTagging replaces every tag, so merge with the current ones.
        const tags = { ...await getTags(client, name), ...opts.tags };
        for (const key of opts.removeTags ?? []) delete tags[key];
        await client.send(new PutBucketTaggingCommand({ Bucket: name, Tagging: { TagSet: toTagList(tags) } }));
    }
    return getBucket(client, name);
}

/** Deletes every object and every version in the bucket. Returns how many were deleted. */
export async function emptyBucket(client: S3Client, name: string): Promise<number> {
    let deleted = 0;
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    do {
        const page = await client.send(new ListObjectVersionsCommand({
            Bucket: name, KeyMarker: keyMarker, VersionIdMarker: versionMarker,
        }));
        const objects: ObjectIdentifier[] = [...page.Versions ?? [], ...page.DeleteMarkers ?? []]
            .map((v) => ({ Key: v.Key ?? '', VersionId: v.VersionId }));
        if (objects.length > 0) {
            const result = await client.send(new DeleteObjectsCommand({ Bucket: name, Delete: { Objects: objects, Quiet: true } }));
            if (result.Errors?.length) {
                const first = result.Errors[0];
                throw new Error(`Could not delete ${result.Errors.length} object(s), e.g. ${first.Key}: ${first.Message}`);
            }
            deleted += objects.length;
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker);
    return deleted;
}

/**
 * Deletes a bucket. S3 refuses to delete a bucket that has objects in it;
 * with `force`, it is emptied first.
 */
export async function deleteBucket(client: S3Client, name: string, { force = false } = {}): Promise<{ name: string; objectsDeleted: number }> {
    const objectsDeleted = force ? await emptyBucket(client, name) : 0;
    await client.send(new DeleteBucketCommand({ Bucket: name }));
    return { name, objectsDeleted };
}

export async function waitForBucket(client: S3Client, name: string, state: 'exists' | 'deleted'): Promise<void> {
    const waiter = state === 'exists' ? waitUntilBucketExists : waitUntilBucketNotExists;
    await waiter({ client, maxWaitTime: MAX_WAIT_SECONDS }, { Bucket: name });
}

// ---- Objects ----

export interface ObjectSummary {
    key: string;
    size?: number;
    modified?: string;
}

export async function listObjects(client: S3Client, bucket: string, { prefix, limit }: { prefix?: string; limit?: number } = {}): Promise<ObjectSummary[]> {
    const objects: ObjectSummary[] = [];
    let token: string | undefined;
    do {
        const page = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: limit ? Math.min(1000, limit - objects.length) : undefined,
        }));
        for (const o of page.Contents ?? []) {
            objects.push({ key: o.Key ?? '', size: o.Size, modified: o.LastModified?.toISOString() });
        }
        token = page.NextContinuationToken;
    } while (token && objects.length < (limit ?? Infinity));
    return objects;
}

export async function uploadObject(
    client: S3Client, bucket: string, key: string, file: string, { contentType }: { contentType?: string } = {},
): Promise<{ bucket: string; key: string; size: number; etag?: string }> {
    const body = await readFile(file);
    const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return { bucket, key, size: body.length, etag: result.ETag };
}

export async function downloadObject(client: S3Client, bucket: string, key: string, file: string): Promise<{ bucket: string; key: string; file: string }> {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    // In Node the body is always a Readable stream.
    if (!(result.Body instanceof Readable)) throw new Error(`Object s3://${bucket}/${key} has no body.`);
    await pipeline(result.Body, createWriteStream(file));
    return { bucket, key, file };
}

export async function deleteObject(client: S3Client, bucket: string, key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
