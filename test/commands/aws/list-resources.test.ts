import { describe, expect, it, vi } from 'vitest';
import { listAwsResources } from '../../../src/provider/aws';
import { errored, logged, runCli } from '../../helpers';

describe('clover aws list-resources', () => {
    it('prints a summary and a table per service that has resources', async () => {
        const buckets = [{ id: 'my-bucket', type: 'bucket' }];
        vi.mocked(listAwsResources).mockResolvedValue({
            region: 'us-east-1',
            services: [
                { service: 'EC2', count: 0, resources: [] },
                { service: 'S3', count: 1, resources: buckets },
                { service: 'RDS', count: 0, resources: [], error: 'AccessDenied' },
            ],
            total: 1,
        });

        await runCli('aws list-resources --profile work');

        expect(listAwsResources).toHaveBeenCalledWith('work');
        expect(console.table).toHaveBeenCalledWith([
            { service: 'EC2', count: 0 },
            { service: 'S3', count: 1 },
            { service: 'RDS', count: 0, error: 'AccessDenied' },
        ]);
        expect(console.table).toHaveBeenCalledWith(buckets);
        expect(logged()).toContain('1 resource(s) across 1 active service(s).');
    });

    it('reports an error when resources cannot be listed', async () => {
        vi.mocked(listAwsResources).mockRejectedValue(new Error('No AWS credentials stored for profile "default"'));

        await runCli('aws list-resources');

        expect(errored()).toContain('No AWS credentials stored');
        expect(process.exitCode).toBe(1);
    });
});
