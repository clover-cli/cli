import { describe, expect, it } from 'vitest';
import { logged, runCli } from '../../helpers';

describe('clover aws logout', () => {
    it('prints the command that unsets every AWS variable', async () => {
        await runCli('aws logout');

        expect(logged()).toBe('unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION');
    });

    it('no longer accepts --profile or --all', async () => {
        await expect(runCli('aws logout --profile work')).rejects.toThrow('Unknown argument');
        await expect(runCli('aws logout --all')).rejects.toThrow('Unknown argument');
    });
});
