import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { askUser } from '../../../src/utils';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

const url = 'https://sqladmin.googleapis.com/v1/projects/p/instances';
const done = { name: 'op-1', status: 'DONE' };
const instance = { name: 'app-db', state: 'RUNNABLE', settings: { tier: 'db-f1-micro' } };

function setup(responses: Record<string, unknown>) {
    vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
    const fake = fakeGcpClient(responses);
    vi.mocked(gcpClient).mockReturnValue(fake.client);
    return fake;
}

describe('clover gcp sql', () => {
    it('creates Postgres 16 on db-f1-micro and waits for it', async () => {
        const { sent } = setup({ 'POST /instances': done, 'GET /operations/op-1': done, 'GET /instances/app-db': instance });

        await runCli('gcp sql create app-db --password hunter22 --labels env=prod --wait --output json');

        expect(sent()[0]).toMatchObject({
            method: 'POST', url,
            data: {
                name: 'app-db', databaseVersion: 'POSTGRES_16', region: 'us-central1', rootPassword: 'hunter22',
                settings: { tier: 'db-f1-micro', userLabels: { env: 'prod' } },
            },
        });
        expect(sent().map((r) => r.url)).toContain('https://sqladmin.googleapis.com/v1/projects/p/operations/op-1');
        expect(JSON.parse(logged())).toMatchObject({ id: 'app-db', status: 'RUNNABLE' });
    });

    it('asks for the root password when none is given', async () => {
        process.stdin.isTTY = true;
        vi.mocked(askUser).mockResolvedValue('secret');
        const { sent } = setup({ 'POST /instances': done, 'GET /instances/app-db': instance });

        await runCli('gcp sql create app-db --project other');

        expect(askUser).toHaveBeenCalledWith('Root password: ', { hidden: true });
        expect(sent()[0]).toMatchObject({ url: 'https://sqladmin.googleapis.com/v1/projects/other/instances', data: { rootPassword: 'secret' } });
    });

    it('requires a password outside a terminal', async () => {
        process.stdin.isTTY = false;
        const { sent } = setup({});

        await runCli('gcp sql create app-db');

        expect(sent()).toEqual([]);
        expect(errored()).toContain('--password');
        expect(process.exitCode).toBe(1);
    });

    it('stops by setting the activation policy to NEVER', async () => {
        const { sent } = setup({ 'PATCH /instances/app-db': done, 'GET /instances/app-db': instance });

        await runCli('gcp sql stop app-db');

        expect(sent()[0]).toMatchObject({ method: 'PATCH', data: { settings: { activationPolicy: 'NEVER' } } });
    });

    it('reboots with a restart', async () => {
        const { sent } = setup({ 'POST /restart': done, 'GET /instances/app-db': instance });

        await runCli('gcp sql reboot app-db');

        expect(sent()[0]).toMatchObject({ method: 'POST', url: `${url}/app-db/restart` });
    });

    it('fails update with nothing to change', async () => {
        const { sent } = setup({});

        await runCli('gcp sql update app-db');

        expect(sent()).toEqual([]);
        expect(errored()).toContain('Nothing to change');
    });

    it('deletes after confirming and waits', async () => {
        const { sent } = setup({ 'DELETE /instances/app-db': done, 'GET /operations/op-1': done });

        await runCli('gcp sql delete app-db -y --wait');

        expect(sent().map((r) => r.method)).toEqual(['DELETE', 'GET']);
        expect(errored()).toContain('Deleted app-db.');
    });
});
