import { describe, expect, it, vi } from 'vitest';
import { getGcpConfig, verifyGcpCredentials } from '../../../src/provider/gcp';
import { askUser } from '../../../src/utils';
import { errored, logged, runCli } from '../../helpers';

const identity = { email: 'sa@p.iam.gserviceaccount.com', project: 'p' };

describe('clover gcp login', () => {
    it('prints export commands for flags without prompting', async () => {
        vi.mocked(verifyGcpCredentials).mockResolvedValue(identity);

        await runCli('gcp login --project p --key-file /key.json');

        expect(askUser).not.toHaveBeenCalled();
        expect(verifyGcpCredentials).toHaveBeenCalledWith({ project: 'p', keyFile: '/key.json' });
        expect(logged()).toBe("export GOOGLE_CLOUD_PROJECT='p'\nexport GOOGLE_APPLICATION_CREDENTIALS='/key.json'");
        expect(errored()).toContain(`Connected as ${identity.email}`);
    });

    it('prompts for missing values and falls back to application default credentials', async () => {
        vi.mocked(verifyGcpCredentials).mockResolvedValue({ email: null, project: 'p' });
        vi.mocked(askUser).mockResolvedValueOnce('p').mockResolvedValueOnce('');

        await runCli('gcp login');

        expect(verifyGcpCredentials).toHaveBeenCalledWith({ project: 'p', keyFile: undefined });
        expect(logged()).toContain('unset GOOGLE_APPLICATION_CREDENTIALS');
        expect(errored()).toContain('Connected as application default credentials');
    });

    it('fails without printing exports when the project is missing', async () => {
        vi.mocked(askUser).mockResolvedValue('');

        await runCli('gcp login');

        expect(verifyGcpCredentials).not.toHaveBeenCalled();
        expect(logged()).toBe('');
        expect(process.exitCode).toBe(1);
    });

    it('fails without printing exports when GCP rejects the credentials', async () => {
        vi.mocked(verifyGcpCredentials).mockRejectedValue(new Error('invalid_grant'));

        await runCli('gcp login --project p --key-file /key.json');

        expect(logged()).toBe('');
        expect(errored()).toContain('Could not connect to GCP: invalid_grant');
        expect(process.exitCode).toBe(1);
    });
});

describe('clover gcp whoami', () => {
    it('prints the identity of the credentials in the environment', async () => {
        vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
        vi.mocked(verifyGcpCredentials).mockResolvedValue(identity);

        await runCli('gcp whoami');

        expect(logged()).toBe(`${identity.email} (project p)`);
    });

    it('reports an error when no project is set', async () => {
        vi.mocked(getGcpConfig).mockImplementation(() => {
            throw new Error('No GCP project found.');
        });

        await runCli('gcp whoami');

        expect(errored()).toContain('No GCP project found');
        expect(process.exitCode).toBe(1);
    });
});

describe('clover gcp logout', () => {
    it('prints the unset command', async () => {
        await runCli('gcp logout');

        expect(logged()).toBe('unset GOOGLE_CLOUD_PROJECT GOOGLE_APPLICATION_CREDENTIALS');
    });
});
