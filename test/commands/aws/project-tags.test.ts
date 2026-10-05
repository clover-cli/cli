import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import { createTable } from '../../../src/provider/aws-services/dynamodb';
import { createInstances } from '../../../src/provider/aws-services/ec2';
import { createFunction } from '../../../src/provider/aws-services/lambda';
import { createDatabase } from '../../../src/provider/aws-services/rds';
import { createBucket } from '../../../src/provider/aws-services/s3';
import { createProject, useProject } from '../../../src/projects';
import { errored, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/ec2');
vi.mock('../../../src/provider/aws-services/rds');
vi.mock('../../../src/provider/aws-services/dynamodb');
vi.mock('../../../src/provider/aws-services/s3');
vi.mock('../../../src/provider/aws-services/lambda');

const creates = [
    { command: 'aws ec2 create', create: createInstances, mock: () => vi.mocked(createInstances).mockResolvedValue([{ id: 'i-1' }]) },
    { command: 'aws rds create app-db --password secret123', create: createDatabase, mock: () => vi.mocked(createDatabase).mockResolvedValue({ id: 'app-db' }) },
    { command: 'aws dynamodb create events --pk id', create: createTable, mock: () => vi.mocked(createTable).mockResolvedValue({ name: 'events' }) },
    { command: 'aws s3 create my-bucket', create: createBucket, mock: () => vi.mocked(createBucket).mockResolvedValue({ name: 'my-bucket' }) },
    { command: 'aws lambda create hello --code index.mjs --role arn:aws:iam::1:role/r', create: createFunction, mock: () => vi.mocked(createFunction).mockResolvedValue({ name: 'hello' }) },
];

describe('project tags on create', () => {
    it.each(creates)('$command tags the resource with the current project', async ({ command, create, mock }) => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        mock();
        createProject('shop');
        useProject('shop');

        await runCli(`${command} --tags env=dev`);

        expect(JSON.stringify(vi.mocked(create).mock.calls[0])).toContain('"tags":{"env":"dev","clover:project":"shop"}');
    });

    it('uses --project over the current project', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createBucket).mockResolvedValue({ name: 'b' });
        createProject('shop');
        createProject('blog');
        useProject('shop');

        await runCli('aws s3 create b --project blog');

        expect(createBucket).toHaveBeenCalledWith(undefined, 'b', expect.objectContaining({ tags: { 'clover:project': 'blog' } }));
    });

    it('adds no project tag when no project is active', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createBucket).mockResolvedValue({ name: 'b' });

        await runCli('aws s3 create b');

        expect(createBucket).toHaveBeenCalledWith(undefined, 'b', expect.objectContaining({ tags: undefined }));
    });

    it('fails on an unknown --project', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);

        await runCli('aws s3 create b --project nope');

        expect(createBucket).not.toHaveBeenCalled();
        expect(errored()).toContain('Unknown project "nope"');
    });
});
