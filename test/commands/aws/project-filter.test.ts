import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig, listAwsResources } from '../../../src/provider/aws';
import { listTables } from '../../../src/provider/aws-services/dynamodb';
import { listInstances } from '../../../src/provider/aws-services/ec2';
import { listFunctions } from '../../../src/provider/aws-services/lambda';
import { listDatabases } from '../../../src/provider/aws-services/rds';
import { listBuckets } from '../../../src/provider/aws-services/s3';
import { addToProject, listProjectResources } from '../../../src/provider/aws-services/tagging';
import { createProject, useProject } from '../../../src/projects';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/ec2');
vi.mock('../../../src/provider/aws-services/rds');
vi.mock('../../../src/provider/aws-services/dynamodb');
vi.mock('../../../src/provider/aws-services/s3');
vi.mock('../../../src/provider/aws-services/lambda');
vi.mock('../../../src/provider/aws-services/tagging');

const inShop = (id: string) => ({ arn: `arn:${id}`, id, service: 'x', project: 'shop' });

const lists = [
    { command: 'aws ec2 list', mock: () => vi.mocked(listInstances).mockResolvedValue([{ id: 'mine' }, { id: 'other' }]) },
    { command: 'aws rds list', mock: () => vi.mocked(listDatabases).mockResolvedValue([{ id: 'mine' }, { id: 'other' }]) },
    { command: 'aws dynamodb list', mock: () => vi.mocked(listTables).mockResolvedValue(['mine', 'other']) },
    { command: 'aws s3 list', mock: () => vi.mocked(listBuckets).mockResolvedValue([{ name: 'mine' }, { name: 'other' }]) },
    { command: 'aws lambda list', mock: () => vi.mocked(listFunctions).mockResolvedValue([{ name: 'mine' }, { name: 'other' }]) },
];

describe('project filter on list', () => {
    it.each(lists)('$command shows only the current project\'s resources', async ({ command, mock }) => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listProjectResources).mockResolvedValue([inShop('mine')]);
        mock();
        createProject('shop');
        useProject('shop');

        await runCli(`${command} --output json`);

        expect(listProjectResources).toHaveBeenCalledWith(undefined, 'shop');
        expect(logged()).toContain('mine');
        expect(logged()).not.toContain('other');
    });

    it('lists everything when no project is active', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listBuckets).mockResolvedValue([{ name: 'mine' }, { name: 'other' }]);

        await runCli('aws s3 list --output json');

        expect(listProjectResources).not.toHaveBeenCalled();
        expect(logged()).toContain('other');
    });
});

describe('clover project get', () => {
    it('includes the project\'s resources', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listProjectResources).mockResolvedValue([inShop('my-bucket')]);
        createProject('shop');

        await runCli('project get shop --output json');

        expect(JSON.parse(logged())).toMatchObject({ name: 'shop', current: false, resources: [{ id: 'my-bucket' }] });
    });

    it('still shows the project when AWS can\'t be reached', async () => {
        vi.mocked(getAwsClientConfig).mockImplementation(() => {
            throw new Error('No AWS credentials found.');
        });
        createProject('shop');

        await runCli('project get shop --output json');

        expect(JSON.parse(logged())).toMatchObject({ name: 'shop' });
        expect(errored()).toContain('No AWS credentials found');
        expect(process.exitCode).toBeUndefined();
    });
});

describe('clover project add', () => {
    it('tags the ARNs with the current project', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        createProject('shop');
        useProject('shop');

        await runCli('project add arn:aws:s3:::b arn:aws:lambda:us-east-1:1:function:f');

        expect(addToProject).toHaveBeenCalledWith(undefined, ['arn:aws:s3:::b', 'arn:aws:lambda:us-east-1:1:function:f'], 'shop');
        expect(errored()).toContain('Added 2 resource(s) to project shop.');
    });

    it('needs a project', async () => {
        await runCli('project add arn:aws:s3:::b');

        expect(addToProject).not.toHaveBeenCalled();
        expect(errored()).toContain('No current project');
        expect(process.exitCode).toBe(1);
    });
});

describe('clover project overview', () => {
    it('shows totals per service and per project', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listAwsResources).mockResolvedValue({
            region: 'us-east-1',
            total: 3,
            services: [{ service: 'EC2', count: 1, resources: [] }, { service: 'S3', count: 2, resources: [] }],
        });
        vi.mocked(listProjectResources).mockResolvedValue([
            { arn: 'a', id: 'i-1', service: 'ec2', project: 'shop' },
            { arn: 'b', id: 'b1', service: 's3', project: 'shop' },
            { arn: 'c', id: 'b2', service: 's3', project: 'old' },
        ]);
        createProject('shop');
        createProject('blog');

        await runCli('project overview --output json');

        expect(listProjectResources).toHaveBeenCalledWith(undefined);
        expect(JSON.parse(logged())).toEqual({
            region: 'us-east-1',
            total: 3,
            services: [{ service: 'EC2', count: 1 }, { service: 'S3', count: 2 }],
            projects: [
                { project: 'shop', total: 2, ec2: 1, s3: 1 },
                { project: 'blog', total: 0 },
                { project: 'old', total: 1, s3: 1 },
            ],
        });
    });
});
