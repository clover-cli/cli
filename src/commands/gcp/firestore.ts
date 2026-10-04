import type { Argv, CommandModule } from 'yargs';
import {
    createDatabase,
    deleteDatabase,
    deleteItem,
    getDatabase,
    getItem,
    listDatabases,
    putItem,
    scanItems,
    updateDatabase,
    waitForOperation,
    type Item,
} from '../../provider/gcp-services/firestore';
import { action, confirm, info, parseJson, print, waitOption, yesOption } from '../aws/shared';
import { gcpCommonOptions, gcpContext, gcpServiceBuilder } from './shared';

const databasePositional = { database: { type: 'string', describe: 'Database ID (`default` for the (default) database)' } } as const;

const documentOptions = {
    collection: { type: 'string', demandOption: true, describe: 'Collection path, e.g. users or users/1/posts' },
    id: { type: 'string', demandOption: true, describe: 'Document ID' },
} as const;

const create = action({
    command: 'create <database>',
    describe: 'Create a Firestore database (native mode) in --region',
    positionals: databasePositional,
    options: {
        ...gcpCommonOptions,
        'deletion-protection': { type: 'boolean', describe: 'Block deletes until turned off' },
        ...waitOption,
    },
    examples: [['$0 gcp firestore create default --region nam5 --wait', 'Create the (default) database in a multi-region']],
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const op = await createDatabase(client, project, argv.database, { location: argv.region, deletionProtection: argv.deletionProtection });
        if (!argv.wait) {
            print(argv, { name: argv.database, status: 'CREATING', operation: op.name });
            return;
        }
        info('Waiting for the database to be created...');
        await waitForOperation(client, op);
        print(argv, await getDatabase(client, project, argv.database));
    },
});

const list = action({
    command: 'list',
    describe: 'List Firestore databases',
    options: gcpCommonOptions,
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        print(argv, await listDatabases(client, project), 'No databases found.');
    },
});

const get = action({
    command: 'get <database>',
    describe: 'Show one Firestore database',
    positionals: databasePositional,
    options: gcpCommonOptions,
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        print(argv, await getDatabase(client, project, argv.database));
    },
});

const update = action({
    command: 'update <database>',
    describe: 'Change a Firestore database (deletion protection)',
    positionals: databasePositional,
    options: {
        ...gcpCommonOptions,
        'deletion-protection': { type: 'boolean', describe: 'Turn deletion protection on or off' },
        ...waitOption,
    },
    examples: [['$0 gcp firestore update default --no-deletion-protection', 'Allow deleting the database']],
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const op = await updateDatabase(client, project, argv.database, { deletionProtection: argv.deletionProtection });
        if (op && argv.wait) {
            info('Waiting for the update to finish...');
            await waitForOperation(client, op);
        }
        print(argv, await getDatabase(client, project, argv.database));
    },
});

const remove = action({
    command: 'delete <database>',
    describe: 'Delete a Firestore database and all its documents',
    positionals: databasePositional,
    options: {
        ...gcpCommonOptions,
        force: { type: 'boolean', default: false, describe: 'Turn off deletion protection first' },
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        if (!await confirm(argv, `Delete database ${argv.database} and every document in it?`)) return;
        const { client, project } = gcpContext(argv);
        const op = await deleteDatabase(client, project, argv.database, { force: argv.force });
        if (argv.wait) {
            info('Waiting for the database to be deleted...');
            await waitForOperation(client, op);
        }
        info(argv.wait ? `Deleted ${argv.database}.` : `Deleting ${argv.database}.`);
    },
});

// ---- Documents ----

function isItem(value: unknown): value is Item {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const putItemAction = action({
    command: 'put-item <database>',
    describe: 'Create or replace a document',
    positionals: databasePositional,
    options: {
        ...gcpCommonOptions,
        ...documentOptions,
        item: { type: 'string', demandOption: true, describe: 'JSON object or @file.json' },
    },
    examples: [[`$0 gcp firestore put-item default --collection users --id 1 --item '{"name":"Ada"}'`, 'Write one document']],
    handler: async (argv) => {
        const item = parseJson(argv.item, '--item');
        if (!isItem(item)) throw new Error('--item must be a JSON object.');
        const { client, project } = gcpContext(argv);
        await putItem(client, project, argv.database, argv.collection, argv.id, item);
        info(`Wrote ${argv.collection}/${argv.id}.`);
    },
});

const getItemAction = action({
    command: 'get-item <database>',
    describe: 'Read one document',
    positionals: databasePositional,
    options: { ...gcpCommonOptions, ...documentOptions },
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const item = await getItem(client, project, argv.database, argv.collection, argv.id);
        if (!item) {
            console.error('Item not found.');
            process.exitCode = 1;
            return;
        }
        // Documents can nest, so always print them as JSON.
        print({ output: 'json' }, item);
    },
});

const deleteItemAction = action({
    command: 'delete-item <database>',
    describe: 'Delete one document',
    positionals: databasePositional,
    options: { ...gcpCommonOptions, ...documentOptions },
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const deleted = await deleteItem(client, project, argv.database, argv.collection, argv.id);
        info(deleted ? 'Deleted.' : 'No such item; nothing deleted.');
    },
});

const scan = action({
    command: 'scan <database>',
    describe: 'Read documents from a collection',
    positionals: databasePositional,
    options: {
        ...gcpCommonOptions,
        collection: documentOptions.collection,
        limit: { type: 'number', default: 25, describe: 'Maximum documents to read (0 for all)' },
    },
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        print(argv, await scanItems(client, project, argv.database, argv.collection, { limit: argv.limit || undefined }), 'No items found.');
    },
});

/**
 * clover gcp firestore <create|list|get|update|delete|put-item|get-item|delete-item|scan>
 */
const firestoreCommand: CommandModule = {
    command: 'firestore',
    describe: 'Create, list, update and delete Firestore databases and documents',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(putItemAction)
        .command(getItemAction)
        .command(deleteItemAction)
        .command(scan)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, put-item, get-item, delete-item or scan'),
    handler: () => {},
};

export default firestoreCommand;
