import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import type { AwsClientConfig } from '../aws';

/** Cost Explorer has a single endpoint, in us-east-1, whatever region the command runs in. */
export function costClient(config: AwsClientConfig): CostExplorerClient {
    return new CostExplorerClient({ ...config, region: 'us-east-1' });
}

export interface MonthlyCost {
    month: string;
    amount: number;
    unit?: string;
}

function isoDate(year: number, month: number): string {
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/** The bill for the last `months` months, this one included (so far). */
export async function monthlyCosts(client: CostExplorerClient, months: number, now = new Date()): Promise<MonthlyCost[]> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const result = await client.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: isoDate(year, month - months + 1), End: isoDate(year, month + 1) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
    }));
    return (result.ResultsByTime ?? []).map((r) => ({
        month: r.TimePeriod?.Start?.slice(0, 7) ?? 'unknown',
        amount: Math.round(Number(r.Total?.UnblendedCost?.Amount ?? 0) * 100) / 100,
        unit: r.Total?.UnblendedCost?.Unit,
    }));
}
