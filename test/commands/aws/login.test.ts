import { describe, expect, it, vi } from 'vitest';
import { saveAwsCredentials } from '../../../src/db';
import { verifyAwsCredentials } from '../../../src/provider/aws';
import { askUser } from '../../../src/utils';
import { errored, logged, runCli } from '../../helpers';

const identity = { accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/test' };

describe('clover aws login', () => {
    it('saves credentials passed as flags without prompting', async () => {
        vi.mocked(verifyAwsCredentials).mockResolvedValue(identity);

        await runCli('aws login --profile work --access-key-id AKIA --secret-access-key SECRET --region eu-west-1');

        expect(askUser).not.toHaveBeenCalled();
        expect(verifyAwsCredentials).toHaveBeenCalledWith({
            accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: undefined, region: 'eu-west-1',
        });
        expect(saveAwsCredentials).toHaveBeenCalledWith({
            profile: 'work',
            access_key_id: 'AKIA',
            secret_access_key: 'SECRET',
            session_token: null,
            region: 'eu-west-1',
            account_id: identity.accountId,
            arn: identity.arn,
        });
        expect(logged()).toContain('Credentials saved under profile "work"');
    });

    it('prompts for missing values and defaults the region to us-east-1', async () => {
        vi.mocked(verifyAwsCredentials).mockResolvedValue(identity);
        vi.mocked(askUser)
            .mockResolvedValueOnce('AKIA')    // access key ID
            .mockResolvedValueOnce('SECRET')  // secret access key
            .mockResolvedValueOnce('');       // region (left empty)

        await runCli('aws login');

        expect(askUser).toHaveBeenCalledWith('AWS Secret Access Key: ', { hidden: true });
        expect(saveAwsCredentials).toHaveBeenCalledWith(
            expect.objectContaining({ profile: 'default', region: 'us-east-1' }),
        );
    });

    it('fails without saving when the keys are missing', async () => {
        vi.mocked(askUser).mockResolvedValue('');

        await runCli('aws login');

        expect(verifyAwsCredentials).not.toHaveBeenCalled();
        expect(saveAwsCredentials).not.toHaveBeenCalled();
        expect(errored()).toContain('required');
        expect(process.exitCode).toBe(1);
    });

    it('fails without saving when AWS rejects the credentials', async () => {
        vi.mocked(verifyAwsCredentials).mockRejectedValue(new Error('InvalidClientTokenId'));

        await runCli('aws login --access-key-id AKIA --secret-access-key WRONG --region us-east-1');

        expect(saveAwsCredentials).not.toHaveBeenCalled();
        expect(errored()).toContain('Could not connect to AWS: InvalidClientTokenId');
        expect(process.exitCode).toBe(1);
    });
});
