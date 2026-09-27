import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createBucket, deleteBucket, updateBucket } from '../../../src/provider/aws-services/s3';
import { fakeClient } from '../../helpers';

vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
    ...await importOriginal<typeof import('@aws-sdk/client-s3')>(),
    waitUntilBucketExists: vi.fn(),
    waitUntilBucketNotExists: vi.fn(),
}));

function noTags() {
    return Object.assign(new Error('The TagSet does not exist'), { name: 'NoSuchTagSet' });
}

describe('createBucket', () => {
    it('omits the location in us-east-1 and sets it elsewhere', async () => {
        const { client, sent } = fakeClient<S3Client>();

        await createBucket(client, 'a', { region: 'us-east-1' });
        await createBucket(client, 'b', { region: 'eu-west-1' });

        expect(sent()[0].input).toEqual({ Bucket: 'a', CreateBucketConfiguration: undefined });
        expect(sent()[1].input).toEqual({ Bucket: 'b', CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' } });
    });

    it('turns on versioning after creating', async () => {
        const { client, sent } = fakeClient<S3Client>({ GetBucketTaggingCommand: noTags() });

        await createBucket(client, 'a', { region: 'us-east-1', versioning: true });

        expect(sent().find((c) => c.name === 'PutBucketVersioningCommand')?.input).toEqual({
            Bucket: 'a', VersioningConfiguration: { Status: 'Enabled' },
        });
    });
});

describe('updateBucket', () => {
    it('merges tags with the existing ones', async () => {
        const { client, sent } = fakeClient<S3Client>({
            GetBucketTaggingCommand: { TagSet: [{ Key: 'env', Value: 'dev' }, { Key: 'old', Value: 'x' }] },
        });

        await updateBucket(client, 'a', { tags: { team: 'core' }, removeTags: ['old'] });

        expect(sent().find((c) => c.name === 'PutBucketTaggingCommand')?.input).toEqual({
            Bucket: 'a', Tagging: { TagSet: [{ Key: 'env', Value: 'dev' }, { Key: 'team', Value: 'core' }] },
        });
    });

    it('suspends versioning with false', async () => {
        const { client, sent } = fakeClient<S3Client>({ GetBucketTaggingCommand: noTags() });

        await updateBucket(client, 'a', { versioning: false });

        expect(sent()[0].input).toEqual({ Bucket: 'a', VersioningConfiguration: { Status: 'Suspended' } });
    });
});

describe('deleteBucket', () => {
    it('deletes every version and delete marker first with force', async () => {
        const { client, sent } = fakeClient<S3Client>({
            ListObjectVersionsCommand: [
                { Versions: [{ Key: 'a', VersionId: '1' }], IsTruncated: true, NextKeyMarker: 'a', NextVersionIdMarker: '1' },
                { DeleteMarkers: [{ Key: 'b', VersionId: '2' }], IsTruncated: false },
            ],
        });

        const result = await deleteBucket(client, 'bucket', { force: true });

        expect(result).toEqual({ name: 'bucket', objectsDeleted: 2 });
        expect(sent().map((c) => c.name)).toEqual([
            'ListObjectVersionsCommand', 'DeleteObjectsCommand', 'ListObjectVersionsCommand', 'DeleteObjectsCommand', 'DeleteBucketCommand',
        ]);
        expect(sent()[2].input).toMatchObject({ KeyMarker: 'a', VersionIdMarker: '1' });
    });

    it('reports objects S3 could not delete', async () => {
        const { client } = fakeClient<S3Client>({
            ListObjectVersionsCommand: { Versions: [{ Key: 'a' }] },
            DeleteObjectsCommand: { Errors: [{ Key: 'a', Message: 'Access Denied' }] },
        });

        await expect(deleteBucket(client, 'bucket', { force: true })).rejects.toThrow('a: Access Denied');
    });
});
