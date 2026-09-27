import { describe, expect, it } from 'vitest';
import { runCli } from '../../helpers';

describe('clover aws', () => {
    it('requires an action', async () => {
        await expect(runCli('aws')).rejects.toThrow('Choose an action');
    });

    it('rejects unknown actions', async () => {
        await expect(runCli('aws deploy')).rejects.toThrow('Unknown argument: deploy');
    });

    it('rejects unknown options', async () => {
        await expect(runCli('aws list --nope')).rejects.toThrow('Unknown argument');
    });
});
