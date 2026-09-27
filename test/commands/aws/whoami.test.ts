import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig, verifyAwsCredentials } from '../../../src/provider/aws';
import { errored, logged, runCli } from '../../helpers';

const config = { region: 'us-east-1', credentials: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET' } };

describe('clover aws whoami', () => {
    it('prints the identity of the credentials in the environment', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(config);
        vi.mocked(verifyAwsCredentials).mockResolvedValue({
            accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/test',
        });

        await runCli('aws whoami');

        expect(verifyAwsCredentials).toHaveBeenCalledWith({ ...config.credentials, region: 'us-east-1' });
        expect(logged()).toContain('arn:aws:iam::123456789012:user/test (account 123456789012, region us-east-1)');
    });

    it('reports an error when no credentials are set', async () => {
        vi.mocked(getAwsClientConfig).mockImplementation(() => {
            throw new Error('No AWS credentials found.');
        });

        await runCli('aws whoami');

        expect(verifyAwsCredentials).not.toHaveBeenCalled();
        expect(errored()).toContain('No AWS credentials found');
        expect(process.exitCode).toBe(1);
    });

    it('reports an error when AWS rejects the credentials', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(config);
        vi.mocked(verifyAwsCredentials).mockRejectedValue(new Error('ExpiredToken'));

        await runCli('aws whoami');

        expect(errored()).toContain('ExpiredToken');
        expect(process.exitCode).toBe(1);
    });

    it('no longer accepts --profile', async () => {
        await expect(runCli('aws whoami --profile work')).rejects.toThrow('Unknown argument');
    });
});
