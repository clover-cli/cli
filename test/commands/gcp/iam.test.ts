import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig, verifyGcpCredentials } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

describe('clover gcp iam', () => {
    it('lists the roles of the service account behind the credentials', async () => {
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        vi.mocked(verifyGcpCredentials).mockResolvedValue({ email: 'sa@p.iam.gserviceaccount.com', project: 'p' });
        vi.mocked(gcpClient).mockReturnValue(fakeGcpClient({
            'POST :getIamPolicy': { bindings: [{ role: 'roles/editor', members: ['serviceAccount:sa@p.iam.gserviceaccount.com'] }] },
        }).client);

        await runCli('gcp iam policies --output json');

        expect(JSON.parse(logged())).toEqual([{ role: 'roles/editor' }]);
    });

    it('explains that user credentials have no email to look up', async () => {
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        vi.mocked(verifyGcpCredentials).mockResolvedValue({ email: null, project: 'p' });
        vi.mocked(gcpClient).mockReturnValue(fakeGcpClient().client);

        await runCli('gcp iam policies');

        expect(errored()).toContain('service account key file');
        expect(process.exitCode).toBe(1);
    });

    it('checks only the services given', async () => {
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        const { client, sent } = fakeGcpClient({ 'POST :testIamPermissions': { permissions: ['cloudsql.instances.list'] } });
        vi.mocked(gcpClient).mockReturnValue(client);

        await runCli('gcp iam check --service sql --output json');

        expect(JSON.parse(logged())).toContainEqual(expect.objectContaining({ service: 'sql', command: 'list', allowed: true }));
        expect(logged()).not.toContain('"service": "storage"');
        expect(sent()).toHaveLength(1);
    });
});
