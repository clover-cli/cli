import { describe, expect, it, vi } from 'vitest';
import { verifyAwsCredentials } from '../../../src/provider/aws';
import { askUser } from '../../../src/utils';
import { errored, logged, runCli } from '../../helpers';

const identity = { accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/test' };

describe('clover aws login', () => {
    it('prints export commands for credentials passed as flags without prompting', async () => {
        vi.mocked(verifyAwsCredentials).mockResolvedValue(identity);

        await runCli('aws login --access-key-id AKIA --secret-access-key SECRET --region eu-west-1');

        expect(askUser).not.toHaveBeenCalled();
        expect(verifyAwsCredentials).toHaveBeenCalledWith({
            accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: undefined, region: 'eu-west-1',
        });
        // stdout holds only shell commands, so `eval "$(clover aws login)"` works.
        expect(logged()).toBe([
            "export AWS_ACCESS_KEY_ID='AKIA'",
            "export AWS_SECRET_ACCESS_KEY='SECRET'",
            'unset AWS_SESSION_TOKEN',
            "export AWS_REGION='eu-west-1'",
        ].join('\n'));
        expect(errored()).toContain(`Connected as ${identity.arn}`);
    });

    it('exports the session token when one is given', async () => {
        vi.mocked(verifyAwsCredentials).mockResolvedValue(identity);

        await runCli('aws login --access-key-id AKIA --secret-access-key SECRET --session-token TOKEN --region us-east-1');

        expect(verifyAwsCredentials).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: 'TOKEN' }));
        expect(logged()).toContain("export AWS_SESSION_TOKEN='TOKEN'");
    });

    it('prompts for missing values and defaults the region to us-east-1', async () => {
        vi.mocked(verifyAwsCredentials).mockResolvedValue(identity);
        vi.mocked(askUser)
            .mockResolvedValueOnce('AKIA')    // access key ID
            .mockResolvedValueOnce('SECRET')  // secret access key
            .mockResolvedValueOnce('');       // region (left empty)

        await runCli('aws login');

        expect(askUser).toHaveBeenCalledWith('AWS Secret Access Key: ', { hidden: true });
        expect(verifyAwsCredentials).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
        expect(logged()).toContain("export AWS_REGION='us-east-1'");
    });

    it('fails without printing exports when the keys are missing', async () => {
        vi.mocked(askUser).mockResolvedValue('');

        await runCli('aws login');

        expect(verifyAwsCredentials).not.toHaveBeenCalled();
        expect(logged()).toBe('');
        expect(errored()).toContain('required');
        expect(process.exitCode).toBe(1);
    });

    it('fails without printing exports when AWS rejects the credentials', async () => {
        vi.mocked(verifyAwsCredentials).mockRejectedValue(new Error('InvalidClientTokenId'));

        await runCli('aws login --access-key-id AKIA --secret-access-key WRONG --region us-east-1');

        expect(logged()).toBe('');
        expect(errored()).toContain('Could not connect to AWS: InvalidClientTokenId');
        expect(process.exitCode).toBe(1);
    });

    it('no longer accepts --profile', async () => {
        await expect(runCli('aws login --profile work')).rejects.toThrow('Unknown argument');
    });
});
