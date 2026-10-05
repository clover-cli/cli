import type { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { describe, expect, it } from 'vitest';
import { addToProject, listProjectResources } from '../../../src/provider/aws-services/tagging';
import { fakeClient } from '../../helpers';

const tagged = (arn: string, project = 'shop') => ({ ResourceARN: arn, Tags: [{ Key: 'clover:project', Value: project }] });

describe('listProjectResources', () => {
    it('filters by the project tag and turns ARNs into the IDs the commands use', async () => {
        const { client, sent } = fakeClient<ResourceGroupsTaggingAPIClient>({
            GetResourcesCommand: [
                { ResourceTagMappingList: [tagged('arn:aws:ec2:us-east-1:1:instance/i-1'), tagged('arn:aws:rds:us-east-1:1:db:app-db')], PaginationToken: 't' },
                { ResourceTagMappingList: [
                    tagged('arn:aws:s3:::my-bucket'),
                    tagged('arn:aws:dynamodb:us-east-1:1:table/events'),
                    tagged('arn:aws:lambda:us-east-1:1:function:hello'),
                ], PaginationToken: '' },
            ],
        });

        const resources = await listProjectResources(client, 'shop');

        expect(resources.map((r) => [r.service, r.id])).toEqual([
            ['ec2', 'i-1'], ['rds', 'app-db'], ['s3', 'my-bucket'], ['dynamodb', 'events'], ['lambda', 'hello'],
        ]);
        expect(sent()[0].input.TagFilters).toEqual([{ Key: 'clover:project', Values: ['shop'] }]);
        expect(sent()[1].input.PaginationToken).toBe('t');
    });

    it('lists every project when none is given', async () => {
        const { client, sent } = fakeClient<ResourceGroupsTaggingAPIClient>({
            GetResourcesCommand: { ResourceTagMappingList: [tagged('arn:aws:s3:::b', 'blog')] },
        });

        await expect(listProjectResources(client)).resolves.toEqual([
            { arn: 'arn:aws:s3:::b', id: 'b', service: 's3', project: 'blog' },
        ]);
        expect(sent()[0].input.TagFilters).toEqual([{ Key: 'clover:project', Values: undefined }]);
    });
});

describe('addToProject', () => {
    it('tags every ARN with the project', async () => {
        const { client, sent } = fakeClient<ResourceGroupsTaggingAPIClient>();

        await addToProject(client, ['arn:aws:s3:::b'], 'shop');

        expect(sent()[0]).toEqual({ name: 'TagResourcesCommand', input: { ResourceARNList: ['arn:aws:s3:::b'], Tags: { 'clover:project': 'shop' } } });
    });

    it('throws with the resources AWS refused', async () => {
        const { client } = fakeClient<ResourceGroupsTaggingAPIClient>({
            TagResourcesCommand: { FailedResourcesMap: { 'arn:aws:s3:::b': { ErrorCode: 'InvalidParameterException', ErrorMessage: 'Access denied' } } },
        });

        await expect(addToProject(client, ['arn:aws:s3:::b'], 'shop')).rejects.toThrow('arn:aws:s3:::b: Access denied');
    });
});
