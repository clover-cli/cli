import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

const base = 'https://compute.googleapis.com/compute/v1/projects/p/zones/us-central1-a';

function setup(responses: Record<string, unknown> = {}) {
    vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
    const fake = fakeGcpClient(responses);
    vi.mocked(gcpClient).mockReturnValue(fake.client);
    return fake;
}

describe('clover gcp compute', () => {
    it('requires an action', async () => {
        await expect(runCli('gcp compute')).rejects.toThrow('Choose an action');
    });

    it('creates an instance in <region>-a with a startup script from a file and waits for it', async () => {
        const script = path.join(mkdtempSync(path.join(tmpdir(), 'clover-')), 'setup.sh');
        writeFileSync(script, '#!/bin/sh\necho hi');
        const { sent } = setup({
            'POST /instances': { name: 'op-1', status: 'RUNNING' },
            'GET /operations/op-1': { status: 'DONE' },
            'GET /instances/web': { name: 'web', status: 'RUNNING', networkInterfaces: [{ networkIP: '10.0.0.2', accessConfigs: [{ natIP: '1.2.3.4' }] }] },
        });

        await runCli(`gcp compute create --name web --startup-script @${script} --labels env=dev --no-public-ip --wait --output json`);

        expect(sent()[0]).toMatchObject({ method: 'POST', url: `${base}/instances` });
        expect(sent()[0].data).toMatchObject({
            name: 'web',
            machineType: 'zones/us-central1-a/machineTypes/e2-micro',
            labels: { env: 'dev' },
            metadata: { items: [{ key: 'startup-script', value: '#!/bin/sh\necho hi' }] },
            networkInterfaces: [{ accessConfigs: [] }],
        });
        expect(JSON.parse(logged())).toMatchObject({ name: 'web', publicIp: '1.2.3.4', privateIp: '10.0.0.2' });
        expect(errored()).toContain('Creating web in us-central1-a.');
    });

    it('requires a name to create', async () => {
        setup();

        await runCli('gcp compute create');

        expect(errored()).toContain('An instance name is required');
        expect(process.exitCode).toBe(1);
    });

    it('lists instances with --project', async () => {
        const { sent } = setup({ 'GET /aggregated/instances': { items: { 'zones/a': { instances: [{ name: 'web', status: 'RUNNING' }] } } } });

        await runCli('gcp compute list --project other --state running --output json');

        expect(gcpClient).toHaveBeenCalledWith({ project: 'other' });
        expect(sent()[0].url).toContain('/projects/other/aggregated/instances');
        expect(JSON.parse(logged())).toEqual([expect.objectContaining({ name: 'web' })]);
    });

    it('needs --yes to delete when not in a terminal', async () => {
        const { sent } = setup();
        process.stdin.isTTY = false;

        await runCli('gcp compute delete web');

        expect(errored()).toContain('Pass --yes');
        expect(sent()).toEqual([]);
    });

    it('deletes instances in the given zone', async () => {
        const { sent } = setup({ 'DELETE /instances/': { name: 'op-1', status: 'PENDING' } });

        await runCli('gcp compute delete a b --zone europe-west1-b --yes');

        expect(sent().map((r) => `${r.method} ${r.url.split('/zones/')[1]}`)).toEqual(['DELETE europe-west1-b/instances/a', 'DELETE europe-west1-b/instances/b']);
    });

    it('reboots with reset', async () => {
        const { sent } = setup({ 'POST /reset': { name: 'op-1' } });

        await runCli('gcp compute reboot web');

        expect(sent()[0]).toMatchObject({ method: 'POST', url: `${base}/instances/web/reset` });
    });
});
