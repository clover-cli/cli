import type { Argv, CommandModule } from 'yargs';
import {
    createDatabase,
    deleteDatabase,
    getDatabase,
    listDatabases,
    rdsClient,
    rebootDatabase,
    startDatabase,
    stopDatabase,
    updateDatabase,
    waitForDatabase,
    type RdsCreateOptions,
} from '../../provider/aws-services/rds';
import { ec2Client } from '../../provider/aws-services/ec2';
import { isMissingDefaultNetwork, restoreDefaultNetwork } from '../../provider/aws-services/network';
import { action, createTags, inProject, clientConfig, confirm, info, parseKeyValues, print, serviceBuilder, tagsOption, waitOption, yesOption } from './shared';

const idPositional = { id: { type: 'string', describe: 'Database instance identifier' } } as const;

const create = action({
    command: 'create <id>',
    describe: 'Create an RDS database instance',
    positionals: idPositional,
    options: {
        engine: { type: 'string', default: 'postgres', describe: 'postgres, mysql, mariadb, ...' },
        'engine-version': { type: 'string', describe: 'Engine version (default: latest)' },
        'instance-class': { type: 'string', alias: 'class', default: 'db.t3.micro', describe: 'Instance class' },
        storage: { type: 'number', default: 20, describe: 'Storage in GiB' },
        'storage-type': { type: 'string', describe: 'gp3, gp2, io1, ...' },
        username: { type: 'string', default: 'dbadmin', describe: 'Master username' },
        password: { type: 'string', describe: 'Master password (default: generated and kept in Secrets Manager)' },
        database: { type: 'string', describe: 'Name of a database to create inside the instance' },
        port: { type: 'number', describe: 'Port (default: the engine default)' },
        'multi-az': { type: 'boolean', describe: 'Keep a standby in another availability zone' },
        public: { type: 'boolean', describe: 'Reachable from outside the VPC' },
        'security-group-ids': { type: 'string', array: true, describe: 'VPC security group IDs' },
        'subnet-group': { type: 'string', describe: 'DB subnet group' },
        'backup-retention': { type: 'number', describe: 'Days to keep automated backups (0 turns them off)' },
        'deletion-protection': { type: 'boolean', describe: 'Block deletes until turned off' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [
        ['$0 aws rds create app-db --database app --wait', 'Postgres on db.t3.micro, ready to connect when it returns'],
        ['$0 aws rds create app-db --engine mysql --class db.t3.small --storage 50 --multi-az', 'A larger MySQL instance'],
    ],
    handler: async (argv) => {
        const config = clientConfig(argv);
        const client = rdsClient(config);
        const options: RdsCreateOptions = {
            engine: argv.engine,
            engineVersion: argv.engineVersion,
            instanceClass: argv.instanceClass,
            storage: argv.storage,
            storageType: argv.storageType,
            username: argv.username,
            password: argv.password,
            database: argv.database,
            port: argv.port,
            multiAz: argv.multiAz,
            public: argv.public,
            securityGroupIds: argv.securityGroupIds?.map(String),
            subnetGroup: argv.subnetGroup,
            backupRetention: argv.backupRetention,
            deletionProtection: argv.deletionProtection,
            tags: createTags(argv),
        };
        let db;
        try {
            db = await createDatabase(client, argv.id, options);
        } catch (err) {
            // Without --subnet-group, RDS uses the default network. If the account doesn't have it, restore it once.
            if (argv.subnetGroup || !isMissingDefaultNetwork(err)) throw err;
            info(`There is no default network in ${config.region}. Restoring AWS's default VPC and subnets (free), then retrying...`);
            const restored = await restoreDefaultNetwork(ec2Client(config));
            info(restored.vpcCreated
                ? `Created the default VPC ${restored.vpcId}.`
                : `Added default subnets in ${restored.subnetsCreated.join(', ') || 'no new zones'} to ${restored.vpcId}.`);
            db = await createDatabase(client, argv.id, options);
        }
        info(`Creating ${argv.id}. This usually takes 5-15 minutes.`);
        if (!argv.password) info('The master password is generated and stored in AWS Secrets Manager (see passwordSecret).');
        if (argv.wait) {
            info('Waiting for the database to become available...');
            await waitForDatabase(client, argv.id, 'available');
            db = await getDatabase(client, argv.id);
        }
        print(argv, db);
    },
});

const list = action({
    command: 'list',
    describe: 'List RDS database instances',
    handler: async (argv) => {
        const dbs = await inProject(argv, await listDatabases(rdsClient(clientConfig(argv))), (db) => db.id);
        print(argv, argv.output === 'json' ? dbs : dbs.map(({ id, engine, version, class: cls, status, storageGb, endpoint }) => ({
            id, engine, version, class: cls, status, storageGb, endpoint,
        })), 'No databases found.');
    },
});

const get = action({
    command: 'get <id>',
    describe: 'Show one RDS database instance',
    positionals: idPositional,
    handler: async (argv) => {
        print(argv, await getDatabase(rdsClient(clientConfig(argv)), argv.id));
    },
});

const update = action({
    command: 'update <id>',
    describe: 'Change an RDS database instance',
    positionals: idPositional,
    options: {
        'instance-class': { type: 'string', alias: 'class', describe: 'New instance class' },
        storage: { type: 'number', describe: 'New storage in GiB (can only grow)' },
        'engine-version': { type: 'string', describe: 'Upgrade to this engine version' },
        password: { type: 'string', describe: 'New master password' },
        'backup-retention': { type: 'number', describe: 'Days to keep automated backups' },
        'multi-az': { type: 'boolean', describe: 'Turn Multi-AZ on or off' },
        public: { type: 'boolean', describe: 'Make reachable from outside the VPC, or not' },
        'deletion-protection': { type: 'boolean', describe: 'Turn deletion protection on or off' },
        'security-group-ids': { type: 'string', array: true, describe: 'Replace the VPC security groups' },
        'apply-immediately': { type: 'boolean', default: false, describe: 'Apply now instead of in the next maintenance window' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [['$0 aws rds update app-db --class db.t3.medium --storage 100 --apply-immediately --wait', 'Scale up now and wait']],
    handler: async (argv) => {
        const client = rdsClient(clientConfig(argv));
        let db = await updateDatabase(client, argv.id, {
            instanceClass: argv.instanceClass,
            storage: argv.storage,
            engineVersion: argv.engineVersion,
            password: argv.password,
            backupRetention: argv.backupRetention,
            multiAz: argv.multiAz,
            public: argv.public,
            deletionProtection: argv.deletionProtection,
            securityGroupIds: argv.securityGroupIds?.map(String),
            applyImmediately: argv.applyImmediately,
            tags: parseKeyValues(argv.tags),
        });
        info(argv.applyImmediately
            ? `Updating ${argv.id}.`
            : `Updated ${argv.id}. Some changes wait for the next maintenance window; pass --apply-immediately to apply them now.`);
        if (argv.wait) {
            info('Waiting for the changes to be applied...');
            await waitForDatabase(client, argv.id, 'modified');
            db = await getDatabase(client, argv.id);
        }
        print(argv, db);
    },
});

const remove = action({
    command: 'delete <id>',
    describe: 'Delete an RDS database instance',
    positionals: idPositional,
    options: {
        'final-snapshot': { type: 'string', describe: 'Take a final snapshot with this name (default: no snapshot)' },
        'keep-backups': { type: 'boolean', default: false, describe: 'Keep automated backups' },
        force: { type: 'boolean', default: false, describe: 'Turn off deletion protection first' },
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        const snapshot = argv.finalSnapshot ? `A final snapshot ${argv.finalSnapshot} will be taken.` : 'No final snapshot will be taken.';
        if (!await confirm(argv, `Delete database ${argv.id}? ${snapshot}`)) return;
        const client = rdsClient(clientConfig(argv));
        const db = await deleteDatabase(client, argv.id, {
            finalSnapshot: argv.finalSnapshot, keepBackups: argv.keepBackups, force: argv.force,
        });
        if (argv.wait) {
            info('Waiting for the database to be deleted...');
            await waitForDatabase(client, argv.id, 'deleted');
            info(`Deleted ${argv.id}.`);
            return;
        }
        print(argv, db);
    },
});

const start = action({
    command: 'start <id>',
    describe: 'Start a stopped RDS database instance',
    positionals: idPositional,
    options: waitOption,
    handler: async (argv) => {
        const client = rdsClient(clientConfig(argv));
        let db = await startDatabase(client, argv.id);
        if (argv.wait) {
            await waitForDatabase(client, argv.id, 'available');
            db = await getDatabase(client, argv.id);
        }
        print(argv, db);
    },
});

const stop = action({
    command: 'stop <id>',
    describe: 'Stop an RDS database instance (AWS starts it again after 7 days)',
    positionals: idPositional,
    options: {
        snapshot: { type: 'string', describe: 'Take a snapshot with this name before stopping' },
    },
    handler: async (argv) => {
        print(argv, await stopDatabase(rdsClient(clientConfig(argv)), argv.id, { snapshot: argv.snapshot }));
    },
});

const reboot = action({
    command: 'reboot <id>',
    describe: 'Reboot an RDS database instance',
    positionals: idPositional,
    options: {
        failover: { type: 'boolean', default: false, describe: 'Fail over to the standby (Multi-AZ only)' },
        ...waitOption,
    },
    handler: async (argv) => {
        const client = rdsClient(clientConfig(argv));
        let db = await rebootDatabase(client, argv.id, { failover: argv.failover });
        if (argv.wait) {
            await waitForDatabase(client, argv.id, 'available');
            db = await getDatabase(client, argv.id);
        }
        print(argv, db);
    },
});

/**
 * clover aws rds <create|list|get|update|delete|start|stop|reboot>
 */
const rdsCommand: CommandModule = {
    command: 'rds',
    describe: 'Create, list, update and delete RDS databases',
    builder: (yargs: Argv) => serviceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(start)
        .command(stop)
        .command(reboot)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, start, stop or reboot'),
    handler: () => {},
};

export default rdsCommand;
