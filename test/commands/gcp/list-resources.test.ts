import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

describe('clover gcp list-resources', () => {
    it('prints a summary and a table per service', async () => {
        const fake = fakeGcpClient({
            'GET :searchAllResources': { results: [
                { name: '//compute.googleapis.com/vm1', displayName: 'vm1', assetType: 'compute.googleapis.com/Instance', state: 'RUNNING' },
            ] },
        });
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        vi.mocked(gcpClient).mockReturnValue(fake.client);

        await runCli('gcp list-resources --project other');

        expect(fake.sent()[0].url).toContain('/projects/other:searchAllResources');
        expect(logged()).toContain('Resources in project other:');
        expect(console.table).toHaveBeenCalledWith([{ service: 'compute', count: 1 }]);
        expect(logged()).toContain('1 resource(s) across 1 service(s).');
    });

    it('reports an error when the Cloud Asset API fails', async () => {
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        vi.mocked(gcpClient).mockReturnValue(fakeGcpClient({ 'GET :searchAllResources': new Error('Cloud Asset API has not been used') }).client);

        await runCli('gcp list-resources');

        expect(errored()).toContain('Cloud Asset API has not been used');
        expect(process.exitCode).toBe(1);
    });
});
