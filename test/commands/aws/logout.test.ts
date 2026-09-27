import { describe, expect, it, vi } from 'vitest';
import { deleteAllAwsCredentials, deleteAwsCredentials, getAwsCredentials } from '../../../src/db';
import type { AwsCredentialRow } from '../../../src/db';
import { logged, runCli } from '../../helpers';

describe('clover aws logout', () => {
    it('deletes the "default" profile when no profile is given', async () => {
        vi.mocked(getAwsCredentials).mockReturnValue({ profile: 'default' } as AwsCredentialRow);

        await runCli('aws logout');

        expect(deleteAwsCredentials).toHaveBeenCalledWith('default');
        expect(logged()).toContain('Deleted AWS credentials for profile "default"');
    });

    it('deletes the given profile', async () => {
        vi.mocked(getAwsCredentials).mockReturnValue({ profile: 'work' } as AwsCredentialRow);

        await runCli('aws logout --profile work');

        expect(deleteAwsCredentials).toHaveBeenCalledWith('work');
    });

    it('does nothing when the profile does not exist', async () => {
        vi.mocked(getAwsCredentials).mockReturnValue(undefined);

        await runCli('aws logout --profile missing');

        expect(deleteAwsCredentials).not.toHaveBeenCalled();
        expect(logged()).toContain('No credentials saved for profile "missing"');
    });

    it('deletes every profile with --all', async () => {
        vi.mocked(deleteAllAwsCredentials).mockReturnValue(3);

        await runCli('aws logout --all');

        expect(deleteAllAwsCredentials).toHaveBeenCalled();
        expect(deleteAwsCredentials).not.toHaveBeenCalled();
        expect(logged()).toContain('Deleted 3 AWS profile(s)');
    });
});
