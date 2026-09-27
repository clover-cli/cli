import type { Argv, CommandModule } from 'yargs';
import {
    IMAGE_ALIASES,
    createInstances,
    ec2Client,
    getInstance,
    listInstances,
    rebootInstances,
    startInstances,
    stopInstances,
    terminateInstances,
    updateInstance,
    waitForInstances,
    type Ec2Summary,
} from '../../provider/aws-services/ec2';
import {
    action, clientConfig, confirm, info, parseKeyValues, print, readText, serviceBuilder, tagsOption, waitOption, yesOption,
} from './shared';

const idsPositional = { ids: { type: 'string', array: true, describe: 'Instance ID(s)' } } as const;
const idPositional = { id: { type: 'string', describe: 'Instance ID' } } as const;

const create = action({
    command: 'create',
    describe: 'Launch EC2 instance(s)',
    options: {
        image: { type: 'string', default: 'al2023', describe: `AMI ID or alias (${Object.keys(IMAGE_ALIASES).join(', ')})` },
        'instance-type': { type: 'string', alias: 'type', default: 't3.micro', describe: 'Instance type' },
        count: { type: 'number', default: 1, describe: 'How many instances to launch' },
        name: { type: 'string', describe: 'Name tag' },
        'key-name': { type: 'string', describe: 'Key pair for SSH' },
        'security-group-ids': { type: 'string', array: true, describe: 'Security group IDs' },
        'subnet-id': { type: 'string', describe: 'Subnet (default: the default VPC)' },
        'user-data': { type: 'string', describe: 'Startup script, inline or @file' },
        'volume-size': { type: 'number', describe: 'Root volume size in GiB' },
        'public-ip': { type: 'boolean', describe: 'Assign a public IP (--no-public-ip to prevent it)' },
        'iam-profile': { type: 'string', describe: 'Instance profile name or ARN' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [
        ['$0 aws ec2 create --name web --type t3.small --key-name me --wait', 'Launch one instance and wait until it runs'],
        ['$0 aws ec2 create --config web.json', 'Launch with every option from a JSON file'],
    ],
    handler: async (argv) => {
        const client = ec2Client(clientConfig(argv));
        const instances = await createInstances(client, {
            image: argv.image,
            instanceType: argv.instanceType,
            count: argv.count,
            name: argv.name,
            keyName: argv.keyName,
            securityGroupIds: argv.securityGroupIds?.map(String),
            subnetId: argv.subnetId,
            userData: argv.userData ? readText(argv.userData) : undefined,
            volumeSize: argv.volumeSize,
            publicIp: argv.publicIp,
            iamInstanceProfile: argv.iamProfile,
            tags: parseKeyValues(argv.tags),
        });
        const ids = instances.map((i) => i.id);
        info(`Launched ${ids.join(', ')}.`);
        if (argv.wait) {
            info('Waiting for the instance(s) to run...');
            await waitForInstances(client, ids, 'running');
            // IPs and state are only known once the instances run, so read them again.
            const running = await Promise.all(ids.map((id) => getInstance(client, id)));
            print(argv, argv.output === 'json' ? running : running.map(row));
        } else {
            print(argv, argv.output === 'json' ? instances : instances.map(row));
        }
    },
});

/** The columns shown in tables. */
function row({ id, name, type, state, az, publicIp, privateIp }: Ec2Summary) {
    return { id, name, type, state, az, publicIp, privateIp };
}

const list = action({
    command: 'list',
    describe: 'List EC2 instances',
    options: {
        state: { type: 'string', array: true, describe: 'Only these states, e.g. running stopped' },
        tag: { type: 'string', array: true, describe: 'Only instances with this tag (Key=Value, repeatable)' },
    },
    handler: async (argv) => {
        const instances = await listInstances(ec2Client(clientConfig(argv)), {
            states: argv.state?.map(String),
            tags: parseKeyValues(argv.tag),
        });
        print(argv, argv.output === 'json' ? instances : instances.map(row), 'No instances found.');
    },
});

const get = action({
    command: 'get <id>',
    describe: 'Show one EC2 instance',
    positionals: idPositional,
    handler: async (argv) => {
        print(argv, await getInstance(ec2Client(clientConfig(argv)), argv.id));
    },
});

const update = action({
    command: 'update <id>',
    describe: 'Change an EC2 instance (type, tags, termination protection)',
    positionals: idPositional,
    options: {
        'instance-type': { type: 'string', alias: 'type', describe: 'New instance type (the instance must be stopped, or use --restart)' },
        restart: { type: 'boolean', default: false, describe: 'Stop, resize and start the instance again when changing its type' },
        name: { type: 'string', describe: 'New Name tag' },
        tags: { type: 'string', array: true, describe: 'Tags to add or change (Key=Value)' },
        'remove-tags': { type: 'string', array: true, describe: 'Tag keys to remove' },
        'termination-protection': { type: 'boolean', describe: 'Turn termination protection on or off (--no-termination-protection)' },
    },
    examples: [['$0 aws ec2 update i-0abc --type t3.large --restart', 'Resize a running instance in one step']],
    handler: async (argv) => {
        const instance = await updateInstance(ec2Client(clientConfig(argv)), argv.id, {
            instanceType: argv.instanceType,
            restart: argv.restart,
            name: argv.name,
            tags: parseKeyValues(argv.tags),
            removeTags: argv.removeTags?.map(String),
            terminationProtection: argv.terminationProtection,
            onProgress: info,
        });
        info(`Updated ${argv.id}.`);
        print(argv, instance);
    },
});

const remove = action({
    command: 'delete <ids..>',
    describe: 'Terminate EC2 instance(s)',
    positionals: idsPositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Turn off termination protection first' },
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        if (!await confirm(argv, `Terminate ${argv.ids.join(', ')}? This cannot be undone.`)) return;
        const client = ec2Client(clientConfig(argv));
        const changes = await terminateInstances(client, argv.ids, { force: argv.force });
        if (argv.wait) {
            info('Waiting for the instance(s) to terminate...');
            await waitForInstances(client, argv.ids, 'terminated');
        }
        print(argv, changes);
    },
});

const start = action({
    command: 'start <ids..>',
    describe: 'Start stopped EC2 instance(s)',
    positionals: idsPositional,
    options: waitOption,
    handler: async (argv) => {
        const client = ec2Client(clientConfig(argv));
        const changes = await startInstances(client, argv.ids);
        if (argv.wait) await waitForInstances(client, argv.ids, 'running');
        print(argv, changes);
    },
});

const stop = action({
    command: 'stop <ids..>',
    describe: 'Stop running EC2 instance(s)',
    positionals: idsPositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Force the stop (like pulling the plug)' },
        ...waitOption,
    },
    handler: async (argv) => {
        const client = ec2Client(clientConfig(argv));
        const changes = await stopInstances(client, argv.ids, { force: argv.force });
        if (argv.wait) await waitForInstances(client, argv.ids, 'stopped');
        print(argv, changes);
    },
});

const reboot = action({
    command: 'reboot <ids..>',
    describe: 'Reboot EC2 instance(s)',
    positionals: idsPositional,
    handler: async (argv) => {
        await rebootInstances(ec2Client(clientConfig(argv)), argv.ids);
        info(`Rebooting ${argv.ids.join(', ')}.`);
    },
});

/**
 * clover aws ec2 <create|list|get|update|delete|start|stop|reboot>
 */
const ec2Command: CommandModule = {
    command: 'ec2',
    describe: 'Create, list, update and delete EC2 instances',
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

export default ec2Command;
