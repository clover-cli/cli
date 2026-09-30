import {
    BatchWriteItemCommand,
    CreateTableCommand,
    DeleteItemCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    DescribeTimeToLiveCommand,
    DynamoDBClient,
    GetItemCommand,
    ListTablesCommand,
    PutItemCommand,
    ScanCommand,
    TagResourceCommand,
    UpdateTableCommand,
    UpdateTimeToLiveCommand,
    waitUntilTableExists,
    waitUntilTableNotExists,
    type AttributeDefinition,
    type AttributeValue,
    type KeySchemaElement,
    type ScalarAttributeType,
    type TableDescription,
    type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { AwsClientConfig } from '../aws';
import { MAX_WAIT_SECONDS, toTagList } from './common';

/**
 * DynamoDB tables (create, read, update, delete) and the items in them.
 * Items are plain JSON; they are converted to and from DynamoDB's typed format here.
 */

export function dynamoDbClient(config: AwsClientConfig): DynamoDBClient {
    return new DynamoDBClient(config);
}

export type Item = Record<string, unknown>;

export interface KeyAttribute {
    name: string;
    type: ScalarAttributeType;
}

/** Parses "id" or "id:S" / "created:N" / "blob:B". The type defaults to S (string). */
export function parseKeyAttribute(spec: string): KeyAttribute {
    const [name, type = 'S'] = spec.split(':');
    const upper = type.toUpperCase();
    if (!name || !isScalarAttributeType(upper)) {
        throw new Error(`Invalid key "${spec}". Use name or name:TYPE, where TYPE is S, N or B.`);
    }
    return { name, type: upper };
}

function isScalarAttributeType(type: string): type is ScalarAttributeType {
    return type === 'S' || type === 'N' || type === 'B';
}

export interface TableSummary {
    name: string;
    status?: string;
    partitionKey?: string;
    sortKey?: string;
    billing?: string;
    readCapacity?: number;
    writeCapacity?: number;
    items?: number;
    sizeBytes?: number;
    deletionProtection?: boolean;
    ttlAttribute?: string;
    arn?: string;
}

function summarize(table: TableDescription): TableSummary {
    const types = Object.fromEntries((table.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType]));
    const key = (role: 'HASH' | 'RANGE') => {
        const name = table.KeySchema?.find((k) => k.KeyType === role)?.AttributeName;
        return name ? `${name}:${types[name]}` : undefined;
    };
    const onDemand = table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST';
    return {
        name: table.TableName ?? 'unknown',
        status: table.TableStatus,
        partitionKey: key('HASH'),
        sortKey: key('RANGE'),
        billing: onDemand ? 'on-demand' : 'provisioned',
        readCapacity: onDemand ? undefined : table.ProvisionedThroughput?.ReadCapacityUnits,
        writeCapacity: onDemand ? undefined : table.ProvisionedThroughput?.WriteCapacityUnits,
        items: table.ItemCount,
        sizeBytes: table.TableSizeBytes,
        deletionProtection: table.DeletionProtectionEnabled,
        arn: table.TableArn,
    };
}

export type Billing = 'on-demand' | 'provisioned';

function throughput(billing: Billing | undefined, read?: number, write?: number) {
    if (billing === 'provisioned' || (billing === undefined && (read || write))) {
        return { BillingMode: 'PROVISIONED' as const, ProvisionedThroughput: { ReadCapacityUnits: read ?? 5, WriteCapacityUnits: write ?? 5 } };
    }
    if (billing === 'on-demand') return { BillingMode: 'PAY_PER_REQUEST' as const };
    return {};
}

export interface TableCreateOptions {
    partitionKey: KeyAttribute;
    sortKey?: KeyAttribute;
    billing?: Billing;
    readCapacity?: number;
    writeCapacity?: number;
    /** Attribute holding an expiry time (epoch seconds). Setting it waits for the table to become active. */
    ttlAttribute?: string;
    deletionProtection?: boolean;
    tags?: Record<string, string>;
}

export async function createTable(client: DynamoDBClient, name: string, opts: TableCreateOptions): Promise<TableSummary> {
    const keys = [opts.partitionKey, ...(opts.sortKey ? [opts.sortKey] : [])];
    const attributes: AttributeDefinition[] = keys.map((k) => ({ AttributeName: k.name, AttributeType: k.type }));
    const schema: KeySchemaElement[] = keys.map((k, i) => ({ AttributeName: k.name, KeyType: i === 0 ? 'HASH' : 'RANGE' }));

    const result = await client.send(new CreateTableCommand({
        TableName: name,
        AttributeDefinitions: attributes,
        KeySchema: schema,
        ...throughput(opts.billing ?? (opts.readCapacity || opts.writeCapacity ? 'provisioned' : 'on-demand'), opts.readCapacity, opts.writeCapacity),
        DeletionProtectionEnabled: opts.deletionProtection,
        Tags: opts.tags ? toTagList(opts.tags) : undefined,
    }));

    if (opts.ttlAttribute) {
        // TTL can only be turned on once the table is active.
        await waitForTable(client, name, 'exists');
        await setTtl(client, name, opts.ttlAttribute);
        return { ...await getTable(client, name), ttlAttribute: opts.ttlAttribute };
    }
    if (!result.TableDescription) throw new Error(`AWS did not return table ${name}.`);
    return summarize(result.TableDescription);
}

export async function listTables(client: DynamoDBClient): Promise<string[]> {
    const names: string[] = [];
    let start: string | undefined;
    do {
        const page = await client.send(new ListTablesCommand({ ExclusiveStartTableName: start }));
        names.push(...(page.TableNames ?? []));
        start = page.LastEvaluatedTableName;
    } while (start);
    return names;
}

export async function getTable(client: DynamoDBClient, name: string): Promise<TableSummary> {
    const [table, ttl] = await Promise.all([
        client.send(new DescribeTableCommand({ TableName: name })),
        client.send(new DescribeTimeToLiveCommand({ TableName: name })),
    ]);
    if (!table.Table) throw new Error(`Table ${name} not found.`);
    const ttlDesc = ttl.TimeToLiveDescription;
    return {
        ...summarize(table.Table),
        ttlAttribute: ttlDesc?.TimeToLiveStatus === 'ENABLED' ? ttlDesc.AttributeName : undefined,
    };
}

/**
 * Send new message and/or set time to live spec to DynamoDB table
 * @param client The DynamoDB client object it will send the message from
 * @param name The name of the TTL to send
 * @param attribute The attributes of the message itself
 * @param enabled Boolean representing whether to show the TTL Spec got enabled or not in that particular table
 */
async function setTtl(client: DynamoDBClient, name: string, attribute: string, enabled = true): Promise<void> {
    await client.send(new UpdateTimeToLiveCommand({
        TableName: name,
        TimeToLiveSpecification: { AttributeName: attribute, Enabled: enabled },
    }));
}

export interface TableUpdateOptions {
    billing?: Billing;
    readCapacity?: number;
    writeCapacity?: number;
    /** An attribute name turns TTL on; an empty string turns it off. */
    ttlAttribute?: string;
    deletionProtection?: boolean;
    tags?: Record<string, string>;
}

export async function updateTable(client: DynamoDBClient, name: string, opts: TableUpdateOptions): Promise<TableSummary> {
    const capacity = throughput(opts.billing, opts.readCapacity, opts.writeCapacity);
    if (Object.keys(capacity).length > 0 || opts.deletionProtection !== undefined) {
        await client.send(new UpdateTableCommand({
            TableName: name,
            ...capacity,
            DeletionProtectionEnabled: opts.deletionProtection,
        }));
    }

    if (opts.ttlAttribute !== undefined) {
        if (opts.ttlAttribute) {
            await setTtl(client, name, opts.ttlAttribute);
        } else {
            const current = await client.send(new DescribeTimeToLiveCommand({ TableName: name }));
            const attribute = current.TimeToLiveDescription?.AttributeName;
            if (attribute) await setTtl(client, name, attribute, false);
        }
    }

    const table = await getTable(client, name);
    if (opts.tags && Object.keys(opts.tags).length > 0) {
        await client.send(new TagResourceCommand({ ResourceArn: table.arn, Tags: toTagList(opts.tags) }));
    }
    return table;
}

export async function deleteTable(client: DynamoDBClient, name: string, { force = false } = {}): Promise<TableSummary> {
    if (force) {
        await client.send(new UpdateTableCommand({ TableName: name, DeletionProtectionEnabled: false }));
        // The table stays in UPDATING briefly; deleting before it's active again fails.
        await waitForTable(client, name, 'exists');
    }
    const result = await client.send(new DeleteTableCommand({ TableName: name }));
    return result.TableDescription ? summarize(result.TableDescription) : { name };
}

export async function waitForTable(client: DynamoDBClient, name: string, state: 'exists' | 'deleted'): Promise<void> {
    const waiter = state === 'exists' ? waitUntilTableExists : waitUntilTableNotExists;
    await waiter({ client, maxWaitTime: MAX_WAIT_SECONDS }, { TableName: name });
}

// ---- Items ----

const BATCH_SIZE = 25;
const BATCH_RETRIES = 5;

/**
 * Writes one item, or many with batched writes (25 per request).
 * Items DynamoDB leaves unprocessed (throttling) are retried with backoff.
 * Returns how many items were written.
 */
export async function putItems(client: DynamoDBClient, table: string, items: Item[]): Promise<number> {
    if (items.length === 1) {
        await client.send(new PutItemCommand({ TableName: table, Item: marshall(items[0], { removeUndefinedValues: true }) }));
        return 1;
    }

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        let requests: WriteRequest[] = items.slice(i, i + BATCH_SIZE).map((item) => ({
            PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
        }));
        for (let attempt = 0; requests.length > 0; attempt++) {
            if (attempt > BATCH_RETRIES) {
                throw new Error(`${requests.length} item(s) were not written after ${BATCH_RETRIES} retries (throttled).`);
            }
            if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
            const result = await client.send(new BatchWriteItemCommand({ RequestItems: { [table]: requests } }));
            requests = result.UnprocessedItems?.[table] ?? [];
        }
    }
    return items.length;
}

export async function getItem(client: DynamoDBClient, table: string, key: Item): Promise<Item | undefined> {
    const result = await client.send(new GetItemCommand({ TableName: table, Key: marshall(key) }));
    return result.Item ? unmarshall(result.Item) : undefined;
}

/** Deletes an item and returns what it held, or undefined if there was no such item. */
export async function deleteItem(client: DynamoDBClient, table: string, key: Item): Promise<Item | undefined> {
    const result = await client.send(new DeleteItemCommand({ TableName: table, Key: marshall(key), ReturnValues: 'ALL_OLD' }));
    return result.Attributes ? unmarshall(result.Attributes) : undefined;
}

/** Reads up to `limit` items (all of them when no limit is given). */
export async function scanItems(client: DynamoDBClient, table: string, { limit }: { limit?: number } = {}): Promise<Item[]> {
    const items: Item[] = [];
    let start: Record<string, AttributeValue> | undefined;
    do {
        const page = await client.send(new ScanCommand({
            TableName: table,
            ExclusiveStartKey: start,
            Limit: limit ? limit - items.length : undefined,
        }));
        items.push(...(page.Items ?? []).map((i) => unmarshall(i)));
        start = page.LastEvaluatedKey;
    } while (start && items.length < (limit ?? Infinity));
    return items;
}
