import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
    createTable, getItem, parseKeyAttribute, putItems, scanItems, updateTable,
} from '../../../src/provider/aws-services/dynamodb';
import { fakeClient } from '../../helpers';

vi.mock('@aws-sdk/client-dynamodb', async (importOriginal) => ({
    ...await importOriginal<typeof import('@aws-sdk/client-dynamodb')>(),
    waitUntilTableExists: vi.fn(),
    waitUntilTableNotExists: vi.fn(),
}));

const table = { Table: { TableName: 'users', TableArn: 'arn:table' } };

describe('parseKeyAttribute', () => {
    it('defaults the type to S', () => {
        expect(parseKeyAttribute('id')).toEqual({ name: 'id', type: 'S' });
        expect(parseKeyAttribute('ts:n')).toEqual({ name: 'ts', type: 'N' });
    });

    it('rejects unknown types', () => {
        expect(() => parseKeyAttribute('id:X')).toThrow('Invalid key');
        expect(() => parseKeyAttribute(':S')).toThrow('Invalid key');
    });
});

describe('createTable', () => {
    it('creates an on-demand table with a composite key', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>({ CreateTableCommand: { TableDescription: { TableName: 'users' } } });

        await createTable(client, 'users', { partitionKey: { name: 'id', type: 'S' }, sortKey: { name: 'ts', type: 'N' } });

        expect(sent()[0].input).toMatchObject({
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }, { AttributeName: 'ts', AttributeType: 'N' }],
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }, { AttributeName: 'ts', KeyType: 'RANGE' }],
        });
    });

    it('switches to provisioned billing when capacity is given', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>({ CreateTableCommand: { TableDescription: {} } });

        await createTable(client, 'users', { partitionKey: { name: 'id', type: 'S' }, readCapacity: 10 });

        expect(sent()[0].input).toMatchObject({
            BillingMode: 'PROVISIONED', ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 5 },
        });
    });

    it('waits for the table before turning on TTL', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>({ CreateTableCommand: { TableDescription: {} }, DescribeTableCommand: table });

        const result = await createTable(client, 'users', { partitionKey: { name: 'id', type: 'S' }, ttlAttribute: 'expiresAt' });

        expect(waitUntilTableExists).toHaveBeenCalled();
        expect(sent()[1]).toEqual({
            name: 'UpdateTimeToLiveCommand',
            input: { TableName: 'users', TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true } },
        });
        expect(result.ttlAttribute).toBe('expiresAt');
    });
});

describe('updateTable', () => {
    it('turns TTL off for the current attribute when given an empty string', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>({
            DescribeTableCommand: table,
            DescribeTimeToLiveCommand: { TimeToLiveDescription: { AttributeName: 'exp', TimeToLiveStatus: 'ENABLED' } },
        });

        await updateTable(client, 'users', { ttlAttribute: '' });

        expect(sent().find((c) => c.name === 'UpdateTimeToLiveCommand')?.input).toEqual({
            TableName: 'users', TimeToLiveSpecification: { AttributeName: 'exp', Enabled: false },
        });
        expect(sent().map((c) => c.name)).not.toContain('UpdateTableCommand');
    });
});

describe('putItems', () => {
    it('writes a single item with PutItem, converting plain JSON', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>();

        await putItems(client, 'users', [{ id: '1', age: 30, tags: ['a'] }]);

        expect(sent()[0]).toEqual({
            name: 'PutItemCommand',
            input: { TableName: 'users', Item: { id: { S: '1' }, age: { N: '30' }, tags: { L: [{ S: 'a' }] } } },
        });
    });

    it('batches many items 25 at a time and retries unprocessed ones', async () => {
        vi.useFakeTimers();
        const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
        const unprocessed = { UnprocessedItems: { users: [{ PutRequest: { Item: { id: { S: '0' } } } }] } };
        const { client, sent } = fakeClient<DynamoDBClient>({ BatchWriteItemCommand: [unprocessed, {}, {}] });

        const written = putItems(client, 'users', items);
        await vi.runAllTimersAsync();

        expect(await written).toBe(30);
        expect(sent().map((c) => c.input.RequestItems)).toMatchObject([
            { users: { length: 25 } }, { users: { length: 1 } }, { users: { length: 5 } },
        ]);
        vi.useRealTimers();
    });
});

describe('getItem', () => {
    it('returns plain JSON, or undefined when missing', async () => {
        const { client } = fakeClient<DynamoDBClient>({ GetItemCommand: [{ Item: { id: { S: '1' }, n: { N: '2' } } }, {}] });

        expect(await getItem(client, 'users', { id: '1' })).toEqual({ id: '1', n: 2 });
        expect(await getItem(client, 'users', { id: '2' })).toBeUndefined();
    });
});

/** One page of a Scan response. */
function page(id: string, more: boolean) {
    return { Items: [{ id: { S: id } }], LastEvaluatedKey: more ? { id: { S: id } } : undefined };
}

describe('scanItems', () => {
    it('follows pages until the limit is reached', async () => {
        const { client, sent } = fakeClient<DynamoDBClient>({ ScanCommand: [page('1', true), page('2', true), page('3', false)] });

        expect(await scanItems(client, 'users', { limit: 2 })).toEqual([{ id: '1' }, { id: '2' }]);
        expect(sent().map((c) => c.input.Limit)).toEqual([2, 1]);
    });
});
