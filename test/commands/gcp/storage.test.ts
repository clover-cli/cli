import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, runCli } from '../../helpers';

function setup(responses: Record<string, unknown> = {}) {
    vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
    const fake = fakeGcpClient(responses);
    vi.mocked(gcpClient).mockReturnValue(fake.client);
    return fake;
}

describe('clover gcp storage', () => {
    it('creates a bucket in --region with versioning and labels', async () => {
        const { sent } = setup({ 'POST /b': { name: 'assets', location: 'EUROPE-WEST1' } });

        await runCli('gcp storage create assets --region europe-west1 --versioning --labels env=prod --project other');

        expect(sent()[0]).toMatchObject({
            params: { project: 'other' },
            data: { name: 'assets', location: 'europe-west1', versioning: { enabled: true }, labels: { env: 'prod' } },
        });
        expect(errored()).toContain('Created bucket assets in EUROPE-WEST1.');
    });

    it('empties and deletes a bucket with --force', async () => {
        const { sent } = setup({ 'GET /o': { items: [{ name: 'a.txt', generation: '1' }] } });

        await runCli('gcp storage delete assets --force --yes');

        expect(sent().filter((r) => r.method === 'DELETE')).toHaveLength(2);
        expect(errored()).toContain('Deleted assets and 1 object(s).');
    });

    it('asks before deleting an object and refuses without a terminal', async () => {
        const { sent } = setup();
        process.stdin.isTTY = false;

        await runCli('gcp storage delete-object assets a.txt');

        expect(sent()).toHaveLength(0);
        expect(process.exitCode).toBe(1);
    });

    it('uploads a file under its own name by default', async () => {
        const { sent } = setup({ 'POST /upload/': { name: 'logo.png' } });
        const file = path.join(await mkdtemp(path.join(tmpdir(), 'clover-')), 'logo.png');
        await writeFile(file, 'png');

        await runCli(['gcp', 'storage', 'upload', 'assets', file]);

        expect(sent()[0].params).toEqual({ uploadType: 'media', name: 'logo.png' });
        expect(errored()).toContain('to gs://assets/logo.png.');
    });
});
