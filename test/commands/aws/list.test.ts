import { describe, expect, it, vi } from 'vitest';
import { listAwsCredentials } from '../../../src/db';
import { logged, runCli } from '../../helpers';

describe('clover aws list', () => {
    it('tells the user to log in when nothing is saved', async () => {
        vi.mocked(listAwsCredentials).mockReturnValue([]);

        await runCli('aws list');

        expect(logged()).toContain('No AWS credentials saved');
        expect(console.table).not.toHaveBeenCalled();
    });

    it('shows saved profiles with the access key masked', async () => {
        vi.mocked(listAwsCredentials).mockReturnValue([{
            profile: 'work',
            access_key_id: 'AKIAABCDEFGH1234',
            secret_access_key: 'SECRET',
            session_token: null,
            region: 'us-east-1',
            account_id: '123456789012',
            arn: 'arn:aws:iam::123456789012:user/test',
            created_at: '2026-01-01 00:00:00',
        }]);

        await runCli('aws list');

        expect(console.table).toHaveBeenCalledWith([{
            profile: 'work',
            accessKeyId: '************1234',
            region: 'us-east-1',
            account: '123456789012',
            savedAt: '2026-01-01 00:00:00',
        }]);
    });
});
