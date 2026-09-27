import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import { createTable, getItem, putItems, scanItems, updateTable } from '../../../src/provider/aws-services/dynamodb';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/dynamodb', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/provider/aws-services/dynamodb')>();
    return {
        parseKeyAttribute: actual.parseKeyAttribute,
        dynamoDbClient: vi.fn(),
        createTable: vi.fn(),
        getTable: vi.fn(),
        listTables: vi.fn(),
        updateTable: vi.fn(),
        deleteTable: vi.fn(),
        waitForTable: vi.fn(),
        putItems: vi.fn(),
        getItem: vi.fn(),
        deleteItem: vi.fn(),
        scanItems: vi.fn(),
    };
});

describe('clover aws dynamodb', () => {
    it('creates a table from the ddb alias with typed keys', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createTable).mockResolvedValue({ name: 'events', status: 'ACTIVE' });

        await runCli('aws ddb create events --pk userId --sk ts:N --ttl-attribute expiresAt');

        expect(createTable).toHaveBeenCalledWith(undefined, 'events', expect.objectContaining({
            partitionKey: { name: 'userId', type: 'S' }, sortKey: { name: 'ts', type: 'N' }, ttlAttribute: 'expiresAt',
        }));
    });

    it('requires a partition key', async () => {
        await expect(runCli('aws dynamodb create events')).rejects.toThrow('partition-key');
    });

    it('puts an array of items', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(putItems).mockResolvedValue(2);

        await runCli(['aws', 'dynamodb', 'put-item', 'users', '--item', '[{"id":"1"}, {"id":"2"}]']);

        expect(putItems).toHaveBeenCalledWith(undefined, 'users', [{ id: '1' }, { id: '2' }]);
        expect(errored()).toContain('Wrote 2 item(s) to users.');
    });

    it('rejects items that are not objects', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);

        await runCli(['aws', 'dynamodb', 'put-item', 'users', '--item', '[1]']);

        expect(putItems).not.toHaveBeenCalled();
        expect(errored()).toContain('Items must be a JSON object');
    });

    it('prints an item as JSON, and fails when it is missing', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(getItem).mockResolvedValueOnce({ id: '1', name: 'Ada' }).mockResolvedValueOnce(undefined);

        await runCli(['aws', 'dynamodb', 'get-item', 'users', '--key', '{"id":"1"}']);
        expect(JSON.parse(logged())).toEqual({ id: '1', name: 'Ada' });

        await runCli(['aws', 'dynamodb', 'get-item', 'users', '--key', '{"id":"2"}']);
        expect(errored()).toContain('Item not found.');
        expect(process.exitCode).toBe(1);
    });

    it('scans with a default limit of 25, or everything with 0', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(scanItems).mockResolvedValue([]);

        await runCli('aws dynamodb scan users');
        await runCli('aws dynamodb scan users --limit 0');

        expect(scanItems).toHaveBeenNthCalledWith(1, undefined, 'users', { limit: 25 });
        expect(scanItems).toHaveBeenNthCalledWith(2, undefined, 'users', { limit: undefined });
    });
});

describe('clover aws dynamodb update', () => {
    it('passes an empty --ttl-attribute through to turn TTL off', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(updateTable).mockResolvedValue({ name: 'users' });

        await runCli(['aws', 'dynamodb', 'update', 'users', '--ttl-attribute', '']);

        expect(updateTable).toHaveBeenCalledWith(undefined, 'users', expect.objectContaining({ ttlAttribute: '' }));
    });
});
