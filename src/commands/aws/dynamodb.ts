import type { Argv, CommandModule } from 'yargs';
import {
    createTable,
    deleteItem,
    deleteTable,
    dynamoDbClient,
    getItem,
    getTable,
    listTables,
    parseKeyAttribute,
    putItems,
    scanItems,
    updateTable,
    waitForTable,
    type Item,
} from '../../provider/aws-services/dynamodb';
import { action, createTags, clientConfig, confirm, info, parseJson, parseKeyValues, print, serviceBuilder, tagsOption, waitOption, yesOption } from './shared';

const tablePositional = { table: { type: 'string', describe: 'Table name' } } as const;

const billingOptions = {
    billing: { choices: ['on-demand', 'provisioned'] as const, describe: 'Billing mode' },
    'read-capacity': { type: 'number', describe: 'Read capacity units (provisioned only)' },
    'write-capacity': { type: 'number', describe: 'Write capacity units (provisioned only)' },
} as const;

const create = action({
    command: 'create <table>',
    describe: 'Create a DynamoDB table',
    positionals: tablePositional,
    options: {
        'partition-key': { type: 'string', alias: 'pk', demandOption: true, describe: 'Partition key as name[:S|N|B], e.g. id or userId:S' },
        'sort-key': { type: 'string', alias: 'sk', describe: 'Sort key as name[:S|N|B], e.g. createdAt:N' },
        ...billingOptions,
        'ttl-attribute': { type: 'string', describe: 'Attribute with an expiry time (epoch seconds); waits for the table' },
        'deletion-protection': { type: 'boolean', describe: 'Block deletes until turned off' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [
        ['$0 aws dynamodb create users --pk id', 'On-demand table keyed by a string id'],
        ['$0 aws dynamodb create events --pk userId --sk ts:N --ttl-attribute expiresAt', 'Composite key with expiring items'],
    ],
    handler: async (argv) => {
        const client = dynamoDbClient(clientConfig(argv));
        let table = await createTable(client, argv.table, {
            partitionKey: parseKeyAttribute(argv.partitionKey),
            sortKey: argv.sortKey ? parseKeyAttribute(argv.sortKey) : undefined,
            billing: argv.billing,
            readCapacity: argv.readCapacity,
            writeCapacity: argv.writeCapacity,
            ttlAttribute: argv.ttlAttribute,
            deletionProtection: argv.deletionProtection,
            tags: createTags(argv),
        });
        if (argv.wait && table.status !== 'ACTIVE') {
            info('Waiting for the table to become active...');
            await waitForTable(client, argv.table, 'exists');
            table = await getTable(client, argv.table);
        }
        print(argv, table);
    },
});

const list = action({
    command: 'list',
    describe: 'List DynamoDB tables',
    handler: async (argv) => {
        const names = await listTables(dynamoDbClient(clientConfig(argv)));
        print(argv, argv.output === 'json' ? names : names.map((name) => ({ name })), 'No tables found.');
    },
});

const get = action({
    command: 'get <table>',
    describe: 'Show one DynamoDB table',
    positionals: tablePositional,
    handler: async (argv) => {
        print(argv, await getTable(dynamoDbClient(clientConfig(argv)), argv.table));
    },
});

const update = action({
    command: 'update <table>',
    describe: 'Change a DynamoDB table (billing, capacity, TTL, protection, tags)',
    positionals: tablePositional,
    options: {
        ...billingOptions,
        'ttl-attribute': { type: 'string', describe: 'Turn TTL on for this attribute ("" turns it off)' },
        'deletion-protection': { type: 'boolean', describe: 'Turn deletion protection on or off' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [['$0 aws dynamodb update users --billing provisioned --read-capacity 10 --write-capacity 5', 'Switch to provisioned capacity']],
    handler: async (argv) => {
        const client = dynamoDbClient(clientConfig(argv));
        let table = await updateTable(client, argv.table, {
            billing: argv.billing,
            readCapacity: argv.readCapacity,
            writeCapacity: argv.writeCapacity,
            ttlAttribute: argv.ttlAttribute,
            deletionProtection: argv.deletionProtection,
            tags: parseKeyValues(argv.tags),
        });
        if (argv.wait) {
            info('Waiting for the table to become active...');
            await waitForTable(client, argv.table, 'exists');
            table = await getTable(client, argv.table);
        }
        print(argv, table);
    },
});

const remove = action({
    command: 'delete <table>',
    describe: 'Delete a DynamoDB table and all its items',
    positionals: tablePositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Turn off deletion protection first' },
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        if (!await confirm(argv, `Delete table ${argv.table} and every item in it?`)) return;
        const client = dynamoDbClient(clientConfig(argv));
        const table = await deleteTable(client, argv.table, { force: argv.force });
        if (argv.wait) {
            info('Waiting for the table to be deleted...');
            await waitForTable(client, argv.table, 'deleted');
            info(`Deleted ${argv.table}.`);
            return;
        }
        print(argv, table);
    },
});

// ---- Items ----

function isItem(value: unknown): value is Item {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asItems(value: unknown): Item[] {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    if (items.length === 0 || !items.every(isItem)) {
        throw new Error('Items must be a JSON object, or an array of objects.');
    }
    return items;
}

function asKey(value: string): Item {
    const [key] = asItems(parseJson(value, '--key'));
    return key;
}

const putItem = action({
    command: 'put-item <table>',
    describe: 'Create or replace item(s)',
    positionals: tablePositional,
    options: {
        item: { type: 'string', demandOption: true, describe: 'JSON object, array of objects, or @file.json' },
    },
    examples: [
        [`$0 aws dynamodb put-item users --item '{"id":"1","name":"Ada"}'`, 'Write one item'],
        ['$0 aws dynamodb put-item users --item @users.json', 'Import an array of items (batched 25 at a time)'],
    ],
    handler: async (argv) => {
        const items = asItems(parseJson(argv.item, '--item'));
        const count = await putItems(dynamoDbClient(clientConfig(argv)), argv.table, items);
        info(`Wrote ${count} item(s) to ${argv.table}.`);
    },
});

const getItemAction = action({
    command: 'get-item <table>',
    describe: 'Read one item by its key',
    positionals: tablePositional,
    options: {
        key: { type: 'string', demandOption: true, describe: 'The item key as JSON, e.g. {"id":"1"}' },
    },
    handler: async (argv) => {
        const item = await getItem(dynamoDbClient(clientConfig(argv)), argv.table, asKey(argv.key));
        if (!item) {
            console.error('Item not found.');
            process.exitCode = 1;
            return;
        }
        // Items can nest, so always print them as JSON.
        print({ output: 'json' }, item);
    },
});

const deleteItemAction = action({
    command: 'delete-item <table>',
    describe: 'Delete one item by its key',
    positionals: tablePositional,
    options: {
        key: { type: 'string', demandOption: true, describe: 'The item key as JSON, e.g. {"id":"1"}' },
    },
    handler: async (argv) => {
        const old = await deleteItem(dynamoDbClient(clientConfig(argv)), argv.table, asKey(argv.key));
        info(old ? 'Deleted.' : 'No such item; nothing deleted.');
        if (old && argv.output === 'json') print(argv, old);
    },
});

const scan = action({
    command: 'scan <table>',
    describe: 'Read items from a table',
    positionals: tablePositional,
    options: {
        limit: { type: 'number', default: 25, describe: 'Maximum items to read (0 for all)' },
    },
    handler: async (argv) => {
        const items = await scanItems(dynamoDbClient(clientConfig(argv)), argv.table, { limit: argv.limit || undefined });
        print(argv, items, 'No items found.');
    },
});

/**
 * clover aws dynamodb <create|list|get|update|delete|put-item|get-item|delete-item|scan>
 */
const dynamoDbCommand: CommandModule = {
    command: 'dynamodb',
    aliases: ['ddb'],
    describe: 'Create, list, update and delete DynamoDB tables and items',
    builder: (yargs: Argv) => serviceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(putItem)
        .command(getItemAction)
        .command(deleteItemAction)
        .command(scan)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, put-item, get-item, delete-item or scan'),
    handler: () => {},
};

export default dynamoDbCommand;
