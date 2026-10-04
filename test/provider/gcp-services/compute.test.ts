import { describe, expect, it } from 'vitest';
import {
    createInstance, IMAGE_ALIASES, listInstances, updateInstance, waitForOperation,
} from '../../../src/provider/gcp-services/compute';
import { fakeGcpClient } from '../../helpers';

const ref = { project: 'p', zone: 'us-central1-a' };
const base = 'https://compute.googleapis.com/compute/v1/projects/p/zones/us-central1-a';

describe('createInstance', () => {
    it('resolves image aliases and sets the startup script, labels and public IP', async () => {
        const { client, sent } = fakeGcpClient({ 'POST /instances': { name: 'op-1' } });

        await expect(createInstance(client, ref, {
            name: 'web', machineType: 'e2-micro', image: 'debian-12', diskSize: 20, startupScript: 'echo hi', labels: { env: 'dev' },
        })).resolves.toEqual({ name: 'op-1' });

        expect(sent()[0]).toMatchObject({ method: 'POST', url: `${base}/instances` });
        expect(sent()[0].data).toMatchObject({
            name: 'web',
            machineType: 'zones/us-central1-a/machineTypes/e2-micro',
            labels: { env: 'dev' },
            disks: [{ boot: true, initializeParams: { sourceImage: IMAGE_ALIASES['debian-12'], diskSizeGb: 20 } }],
            networkInterfaces: [{ accessConfigs: [{ type: 'ONE_TO_ONE_NAT' }] }],
            metadata: { items: [{ key: 'startup-script', value: 'echo hi' }] },
        });
    });

    it('leaves out the external IP with publicIp false', async () => {
        const { client, sent } = fakeGcpClient();

        await createInstance(client, ref, { name: 'web', machineType: 'e2-micro', image: 'projects/x/global/images/y', publicIp: false });

        expect(sent()[0].data).toMatchObject({
            disks: [{ initializeParams: { sourceImage: 'projects/x/global/images/y' } }],
            networkInterfaces: [{ accessConfigs: [] }],
        });
    });
});

describe('listInstances', () => {
    it('flattens every zone across pages and filters by status and label', async () => {
        const { client } = fakeGcpClient({
            'GET /aggregated/instances': [
                { items: { 'zones/a': { instances: [{ name: 'a', status: 'RUNNING', labels: { env: 'dev' }, zone: 'x/zones/a' }] }, 'zones/b': {} }, nextPageToken: 't' },
                { items: { 'zones/c': { instances: [{ name: 'c', status: 'TERMINATED', labels: { env: 'dev' } }, { name: 'd', status: 'RUNNING' }] } } },
            ],
        });

        const found = await listInstances(client, 'p', { statuses: ['running'], labels: { env: 'dev' } });

        expect(found).toEqual([expect.objectContaining({ name: 'a', zone: 'a', status: 'RUNNING' })]);
    });
});

describe('waitForOperation', () => {
    it('throws the operation error', async () => {
        const { client, sent } = fakeGcpClient({ 'GET /operations/op-1': { status: 'DONE', error: { errors: [{ message: 'quota exceeded' }] } } });

        await expect(waitForOperation(client, ref, { name: 'op-1' })).rejects.toThrow('quota exceeded');
        expect(sent()[0].url).toBe(`${base}/operations/op-1`);
    });
});

describe('updateInstance', () => {
    it('refuses to resize a running instance without restart', async () => {
        const { client, sent } = fakeGcpClient({ 'GET /instances/web': { name: 'web', status: 'RUNNING' } });

        await expect(updateInstance(client, ref, 'web', { machineType: 'e2-small', labels: { a: 'b' } })).rejects.toThrow('--restart');
        expect(sent().filter((r) => r.method === 'POST')).toEqual([]);
    });

    it('merges labels, then stops, resizes and starts with restart', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /instances/web': { name: 'web', status: 'RUNNING', labels: { env: 'dev', old: 'x' }, labelFingerprint: 'fp' },
            'GET /operations/': { status: 'DONE' },
            'POST /instances/web/': { name: 'op' },
        });

        await updateInstance(client, ref, 'web', { machineType: 'e2-small', restart: true, labels: { team: 'core' }, removeLabels: ['old'] });

        const posts = sent().filter((r) => r.method === 'POST');
        expect(posts.map((r) => r.url.split('/').pop())).toEqual(['setLabels', 'stop', 'setMachineType', 'start']);
        expect(posts[0].data).toEqual({ labels: { env: 'dev', team: 'core' }, labelFingerprint: 'fp' });
        expect(posts[2].data).toEqual({ machineType: 'zones/us-central1-a/machineTypes/e2-small' });
    });
});
