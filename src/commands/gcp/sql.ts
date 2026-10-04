import type { Argv, CommandModule } from 'yargs';
import {
    createDatabase,
    deleteDatabase,
    getDatabase,
    listDatabases,
    rebootDatabase,
    startDatabase,
    stopDatabase,
    updateDatabase,
    waitForOperation,
    type SqlOperation,
} from '../../provider/gcp-services/sql';
import type { GcpClient } from '../../provider/gcp';
import { askUser } from '../../utils';
import { action, confirm, info, parseKeyValues, print, waitOption, yesOption } from '../aws/shared';
import { DEFAULT_GCP_REGION, gcpContext, gcpServiceBuilder } from './shared';

const idPositional = { id: { type: 'string', describe: 'Cloud SQL instance name' } } as const;
const labelsOption = { labels: { type: 'string', array: true, describe: 'Labels as Key=Value (repeatable)' } } as const;

/** With --wait, follows the operation to the end; then prints the instance. */
async function finish(argv: { output?: string; wait?: boolean; id: string }, client: GcpClient, project: string, op: SqlOperation): Promise<void> {
    if (argv.wait) {
        info('Waiting for the operation to finish...');
        await waitForOperation(client, project, op);
    }
    print(argv, await getDatabase(client, project, argv.id));
}

const create = action({
    command: 'create <id>',
    describe: 'Create a Cloud SQL instance',
    positionals: idPositional,
    options: {
        'database-version': { type: 'string', alias: 'engine', default: 'POSTGRES_16', describe: 'POSTGRES_16, MYSQL_8_0, SQLSERVER_2022_EXPRESS, ...' },
        tier: { type: 'string', default: 'db-f1-micro', describe: 'Machine tier' },
        storage: { type: 'number', describe: 'Storage in GiB (default: 10)' },
        password: { type: 'string', describe: 'Root user password (asked for when omitted)' },
        public: { type: 'boolean', describe: 'Give the instance a public IPv4 address' },
        'deletion-protection': { type: 'boolean', describe: 'Block deletes until turned off' },
        ...labelsOption,
        ...waitOption,
    },
    examples: [['$0 gcp sql create app-db --wait', 'Postgres 16 on db-f1-micro, ready when it returns']],
    handler: async (argv) => {
        let password = argv.password;
        if (!password) {
            if (!process.stdin.isTTY) throw new Error('A root password is required. Pass --password.');
            password = await askUser('Root password: ', { hidden: true });
            if (!password) throw new Error('A root password is required.');
        }
        const { client, project } = gcpContext({ project: argv.project });
        const op = await createDatabase(client, project, argv.id, {
            databaseVersion: argv.databaseVersion,
            tier: argv.tier,
            region: argv.region ?? DEFAULT_GCP_REGION,
            storage: argv.storage,
            password,
            public: argv.public,
            deletionProtection: argv.deletionProtection,
            labels: parseKeyValues(argv.labels, 'label'),
        });
        info(`Creating ${argv.id}. This usually takes 5-15 minutes.`);
        await finish(argv, client, project, op);
    },
});

const list = action({
    command: 'list',
    describe: 'List Cloud SQL instances',
    handler: async (argv) => {
        const { client, project } = gcpContext({ project: argv.project });
        const dbs = await listDatabases(client, project);
        print(argv, argv.output === 'json' ? dbs : dbs.map(({ id, version, tier, status, activation, storageGb, ip, region }) => ({
            id, version, tier, status, activation, storageGb, ip, region,
        })), 'No databases found.');
    },
});

const get = action({
    command: 'get <id>',
    describe: 'Show one Cloud SQL instance',
    positionals: idPositional,
    handler: async (argv) => {
        const { client, project } = gcpContext({ project: argv.project });
        print(argv, await getDatabase(client, project, argv.id));
    },
});

const update = action({
    command: 'update <id>',
    describe: 'Change a Cloud SQL instance',
    positionals: idPositional,
    options: {
        tier: { type: 'string', describe: 'New machine tier (restarts the instance)' },
        storage: { type: 'number', describe: 'New storage in GiB (can only grow)' },
        public: { type: 'boolean', describe: 'Add or remove the public IPv4 address' },
        'deletion-protection': { type: 'boolean', describe: 'Turn deletion protection on or off' },
        ...labelsOption,
        ...waitOption,
    },
    examples: [['$0 gcp sql update app-db --tier db-g1-small --storage 50 --wait', 'Scale up and wait']],
    handler: async (argv) => {
        const { client, project } = gcpContext({ project: argv.project });
        const op = await updateDatabase(client, project, argv.id, {
            tier: argv.tier,
            storage: argv.storage,
            public: argv.public,
            deletionProtection: argv.deletionProtection,
            labels: parseKeyValues(argv.labels, 'label'),
        });
        if (!op) throw new Error('Nothing to change. Pass --tier, --storage, --public, --deletion-protection or --labels.');
        info(`Updating ${argv.id}.`);
        await finish(argv, client, project, op);
    },
});

const remove = action({
    command: 'delete <id>',
    describe: 'Delete a Cloud SQL instance and its backups',
    positionals: idPositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Turn off deletion protection first' },
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        if (!await confirm(argv, `Delete database ${argv.id}? Its automated backups are deleted too.`)) return;
        const { client, project } = gcpContext({ project: argv.project });
        const op = await deleteDatabase(client, project, argv.id, { force: argv.force });
        if (argv.wait) {
            info('Waiting for the database to be deleted...');
            await waitForOperation(client, project, op);
            info(`Deleted ${argv.id}.`);
            return;
        }
        info(`Deleting ${argv.id}.`);
        print(argv, { id: argv.id, operation: op.name, status: op.status });
    },
});

/** start, stop and reboot: one call, then the same --wait handling. */
function powerAction(command: string, describe: string, call: typeof startDatabase) {
    return action({
        command: `${command} <id>`,
        describe,
        positionals: idPositional,
        options: waitOption,
        handler: async (argv) => {
            const { client, project } = gcpContext({ project: argv.project });
            await finish(argv, client, project, await call(client, project, argv.id));
        },
    });
}

/**
 * clover gcp sql <create|list|get|update|delete|start|stop|reboot>
 */
const sqlCommand: CommandModule = {
    command: 'sql',
    describe: 'Create, list, update and delete Cloud SQL databases',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(powerAction('start', 'Start a stopped Cloud SQL instance', startDatabase))
        .command(powerAction('stop', 'Stop a Cloud SQL instance (you keep paying for storage)', stopDatabase))
        .command(powerAction('reboot', 'Restart a Cloud SQL instance', rebootDatabase))
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, start, stop or reboot'),
    handler: () => {},
};

export default sqlCommand;
