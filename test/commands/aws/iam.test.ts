import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig, verifyAwsCredentials } from '../../../src/provider/aws';
import { checkCommands, listPolicies } from '../../../src/provider/aws-services/iam';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/iam', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../src/provider/aws-services/iam')>(),
    listPolicies: vi.fn(),
    checkCommands: vi.fn(),
}));

const clover = { kind: 'user', name: 'clover-cli', account: '123456789012', partition: 'aws' };

describe('clover aws iam', () => {
    it('lists the policies of the IAM user behind the credentials', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(verifyAwsCredentials).mockResolvedValue({ accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/clover-cli' });
        vi.mocked(listPolicies).mockResolvedValue([{ name: 'ReadOnlyAccess', type: 'aws-managed', via: 'user' }]);

        await runCli('aws iam policies --output json');

        expect(listPolicies).toHaveBeenCalledWith(expect.anything(), clover);
        expect(JSON.parse(logged())).toEqual([{ name: 'ReadOnlyAccess', type: 'aws-managed', via: 'user' }]);
    });

    it('checks only the services given', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(verifyAwsCredentials).mockResolvedValue({ accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/clover-cli' });
        vi.mocked(checkCommands).mockResolvedValue([]);

        await runCli('aws iam check --service s3 lambda');

        expect(checkCommands).toHaveBeenCalledWith(expect.anything(), clover, ['s3', 'lambda']);
    });

    it('fails with a clear message for the root user', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(verifyAwsCredentials).mockResolvedValue({ accountId: '123456789012', arn: 'arn:aws:iam::123456789012:root' });

        await runCli('aws iam policies');

        expect(errored()).toContain('root user');
        expect(process.exitCode).toBe(1);
    });
});
