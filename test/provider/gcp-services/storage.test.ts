import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBucket, deleteBucket, downloadObject, updateBucket, uploadObject } from '../../../src/provider/gcp-services/storage';
import { fakeGcpClient } from '../../helpers';

const API = 'https://storage.googleapis.com/storage/v1/b';

describe('createBucket', () => {
    it('posts the bucket with location, versioning and labels', async () => {
        const { client, sent } = fakeGcpClient({ 'POST /b': { name: 'a', location: 'US-CENTRAL1', versioning: { enabled: true } } });

        const bucket = await createBucket(client, 'p', 'a', { location: 'us-central1', versioning: true, labels: { env: 'prod' } });

        expect(sent()[0]).toMatchObject({
            method: 'POST', url: API, params: { project: 'p' },
            data: { name: 'a', location: 'us-central1', versioning: { enabled: true }, labels: { env: 'prod' } },
        });
        expect(bucket).toMatchObject({ name: 'a', location: 'US-CENTRAL1', versioning: true });
    });
});

describe('updateBucket', () => {
    it('patches labels, removing keys with null', async () => {
        const { client, sent } = fakeGcpClient({ 'PATCH /b/a': { name: 'a' } });

        await updateBucket(client, 'a', { versioning: false, labels: { team: 'core' }, removeLabels: ['old'] });

        expect(sent()[0]).toMatchObject({
            method: 'PATCH', url: `${API}/a`,
            data: { versioning: { enabled: false }, labels: { team: 'core', old: null } },
        });
    });
});

describe('deleteBucket', () => {
    it('deletes every object generation first with force', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /o': { items: [{ name: 'x/y.txt', generation: '1' }, { name: 'x/y.txt', generation: '2' }] },
        });

        await expect(deleteBucket(client, 'a', { force: true })).resolves.toEqual({ name: 'a', objectsDeleted: 2 });

        expect(sent()[0].params).toMatchObject({ versions: true });
        expect(sent().slice(1).map((r) => [r.method, r.url, r.params?.generation])).toEqual([
            ['DELETE', `${API}/a/o/x%2Fy.txt`, '1'],
            ['DELETE', `${API}/a/o/x%2Fy.txt`, '2'],
            ['DELETE', `${API}/a`, undefined],
        ]);
    });
});

describe('objects', () => {
    it('uploads the file bytes with its content type and downloads them back', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'clover-'));
        await writeFile(path.join(dir, 'in.txt'), 'hello');
        const { client, sent } = fakeGcpClient({
            'POST /upload/': { name: 'k', generation: '7' },
            'GET /o/': new TextEncoder().encode('hello').buffer,
        });

        const up = await uploadObject(client, 'a', 'k', path.join(dir, 'in.txt'), { contentType: 'text/plain' });
        await downloadObject(client, 'a', 'k', path.join(dir, 'out.txt'));

        expect(up).toEqual({ bucket: 'a', key: 'k', size: 5, generation: '7' });
        expect(sent()[0]).toMatchObject({ params: { uploadType: 'media', name: 'k' }, headers: { 'Content-Type': 'text/plain' } });
        expect(sent()[1]).toMatchObject({ url: `${API}/a/o/k`, params: { alt: 'media' }, responseType: 'arraybuffer' });
        expect(await readFile(path.join(dir, 'out.txt'), 'utf8')).toBe('hello');
    });
});
