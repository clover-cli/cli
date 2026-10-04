import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFunction, invokeFunction, updateFunction, waitForOperation } from '../../../src/provider/gcp-services/functions';
import { fakeGcpClient } from '../../helpers';

const where = { project: 'p', region: 'us-central1' };
const base = 'https://cloudfunctions.googleapis.com/v2/projects/p/locations/us-central1/functions';
const upload = { uploadUrl: 'https://storage.googleapis.com/signed', storageSource: { bucket: 'b', object: 'o' } };

function sourceDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
    writeFileSync(path.join(dir, 'index.js'), 'exports.hello = () => 1;');
    return dir;
}

function stubFetch() {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(''));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createFunction', () => {
    it('uploads the zipped source, then creates the function from it', async () => {
        const fetch = stubFetch();
        const { client, sent } = fakeGcpClient({ 'POST :generateUploadUrl': upload, 'POST /functions': { name: 'operations/op1' } });

        const op = await createFunction(client, where, 'hello', {
            source: sourceDir(), runtime: 'nodejs22', entryPoint: 'hello', memory: 256, timeout: 60, environment: { A: '1' }, labels: { team: 'x' },
        });

        expect(op.name).toBe('operations/op1');
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(upload.uploadUrl);
        expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/zip' } });
        expect(init.body instanceof Uint8Array && Buffer.from(init.body).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        expect(sent()[1]).toEqual({
            method: 'POST',
            url: base,
            params: { functionId: 'hello' },
            data: {
                description: undefined,
                labels: { team: 'x' },
                buildConfig: { runtime: 'nodejs22', entryPoint: 'hello', source: { storageSource: upload.storageSource } },
                serviceConfig: { availableMemory: '256M', timeoutSeconds: 60, environmentVariables: { A: '1' } },
            },
        });
    });

    it('throws when the upload fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
        const { client } = fakeGcpClient({ 'POST :generateUploadUrl': upload });

        await expect(createFunction(client, where, 'hello', { source: sourceDir(), runtime: 'nodejs22' })).rejects.toThrow('403 denied');
    });
});

describe('updateFunction', () => {
    it('merges environment and labels and only masks what was given', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /functions/api': { name: 'x/functions/api', labels: { a: '1' }, serviceConfig: { environmentVariables: { A: '1', B: '2' } } },
            'PATCH /functions/api': { name: 'operations/op2' },
        });

        await updateFunction(client, where, 'api', { memory: 512, environment: { C: '3' }, removeEnvironment: ['A'], labels: { b: '2' } });

        const patch = sent()[1];
        expect(patch.params).toEqual({ updateMask: 'labels,serviceConfig.availableMemory,serviceConfig.environmentVariables' });
        expect(patch.data).toMatchObject({
            labels: { a: '1', b: '2' },
            serviceConfig: { availableMemory: '512M', environmentVariables: { B: '2', C: '3' } },
        });
    });

    it('uploads new source without reading the function', async () => {
        stubFetch();
        const { client, sent } = fakeGcpClient({ 'POST :generateUploadUrl': upload, 'PATCH /functions/api': { name: 'operations/op3' } });

        await updateFunction(client, where, 'api', { source: sourceDir() });

        expect(sent().map((r) => r.method)).toEqual(['POST', 'PATCH']);
        expect(sent()[1].params).toEqual({ updateMask: 'buildConfig.source' });
    });

    it('does nothing without changes', async () => {
        const { client, sent } = fakeGcpClient();

        expect(await updateFunction(client, where, 'api', {})).toBeNull();
        expect(sent()).toEqual([]);
    });
});

describe('waitForOperation', () => {
    it('polls until done and throws the operation error', async () => {
        const { client, sent } = fakeGcpClient({ 'GET operations/op1': [{ done: false }, { done: true }], 'GET operations/bad': { done: true, error: { message: 'build failed' } } });

        await waitForOperation(client, { name: 'projects/p/locations/r/operations/op1' }, 0);
        expect(sent()[0].url).toBe('https://cloudfunctions.googleapis.com/v2/projects/p/locations/r/operations/op1');
        expect(sent()).toHaveLength(2);
        await expect(waitForOperation(client, { name: 'operations/bad' }, 0)).rejects.toThrow('build failed');
    });
});

describe('invokeFunction', () => {
    it('posts the payload to the function URL', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /functions/api': { name: 'api', serviceConfig: { uri: 'https://api-xyz.a.run.app' } },
            'POST run.app': { ok: true },
        });

        expect(await invokeFunction(client, where, 'api', { name: 'Ada' })).toEqual({ ok: true });
        expect(sent()[1]).toMatchObject({ method: 'POST', url: 'https://api-xyz.a.run.app', data: { name: 'Ada' } });
    });
});
