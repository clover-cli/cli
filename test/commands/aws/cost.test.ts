import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import { monthlyCosts } from '../../../src/provider/aws-services/cost';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/cost');

describe('clover aws cost', () => {
    it('requires an action', async () => {
        await expect(runCli('aws cost')).rejects.toThrow('Choose an action');
    });

    it('shows the last six months by default', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(monthlyCosts).mockResolvedValue([{ month: '2026-01', amount: 12.35, unit: 'USD' }]);

        await runCli('aws cost monthly --output json');

        expect(monthlyCosts).toHaveBeenCalledWith(undefined, 6);
        expect(JSON.parse(logged())).toEqual([{ month: '2026-01', amount: 12.35, unit: 'USD' }]);
    });

    it('rejects fewer than one month', async () => {
        await runCli('aws cost monthly --months 0');

        expect(monthlyCosts).not.toHaveBeenCalled();
        expect(errored()).toContain('--months must be at least 1.');
        expect(process.exitCode).toBe(1);
    });
});
