import type { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { describe, expect, it } from 'vitest';
import { costClient, monthlyCosts } from '../../../src/provider/aws-services/cost';
import { fakeClient, testConfig } from '../../helpers';

describe('costClient', () => {
    it('always uses us-east-1', async () => {
        expect(await costClient({ ...testConfig, region: 'eu-west-1' }).config.region()).toBe('us-east-1');
    });
});

describe('monthlyCosts', () => {
    it('asks for whole months up to the end of this one, across a year boundary', async () => {
        const { client, sent } = fakeClient<CostExplorerClient>();

        await monthlyCosts(client, 3, new Date('2026-01-15T00:00:00Z'));

        expect(sent()[0].input).toEqual({
            TimePeriod: { Start: '2025-11-01', End: '2026-02-01' },
            Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'],
        });
    });

    it('returns each month\'s cost rounded to cents', async () => {
        const { client } = fakeClient<CostExplorerClient>({
            GetCostAndUsageCommand: {
                ResultsByTime: [{ TimePeriod: { Start: '2026-01-01' }, Total: { UnblendedCost: { Amount: '12.3456', Unit: 'USD' } } }],
            },
        });

        expect(await monthlyCosts(client, 1)).toEqual([{ month: '2026-01', amount: 12.35, unit: 'USD' }]);
    });
});
