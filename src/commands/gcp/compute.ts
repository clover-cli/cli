import type { Argv, CommandModule } from 'yargs';
import {
    IMAGE_ALIASES,
    createInstance,
    deleteInstance,
    getInstance,
    instanceOp,
    listInstances,
    updateInstance,
    waitForOperation,
    type ComputeSummary,
    type Operation,
    type ZoneRef,
} from '../../provider/gcp-services/compute';
import type { GcpClient } from '../../provider/gcp';
import { action, confirm, info, parseKeyValues, print, readText, yesOption } from '../aws/shared';
import { gcpContext, gcpServiceBuilder } from './shared';

const waitOption = { wait: { type: 'boolean', default: false, describe: 'Wait until GCP finishes the operation' } } as const;
const zoneOption = { zone: { type: 'string', describe: 'Zone (default: <region>-a)' } } as const;
const labelsOption = { labels: { type: 'string', array: true, describe: 'Labels as Key=Value (repeatable)' } } as const;
const namesPositional = { names: { type: 'string', array: true, describe: 'Instance name(s)' } } as const;
const namePositional = { name: { type: 'string', describe: 'Instance name' } } as const;

/** The client, project and zone for a command; the zone defaults to <region>-a. */
function context(argv: { project?: unknown; region?: string; zone?: string }): { client: GcpClient; ref: ZoneRef } {
    const { client, project } = gcpContext(argv);
    return { client, ref: { project, zone: argv.zone ?? `${argv.region}-a` } };
}

/** The columns shown in tables. */
function row({ name, machineType, status, zone, publicIp, privateIp }: ComputeSummary) {
    return { name, machineType, status, zone, publicIp, privateIp };
}

/** Starts an operation per instance, optionally waits for them all, and prints them. */
async function eachInstance(argv: { output?: string; wait?: boolean }, client: GcpClient, ref: ZoneRef, names: string[], run: (name: string) => Promise<Operation>) {
    const ops = await Promise.all(names.map(run));
    if (argv.wait) await Promise.all(ops.map((op) => waitForOperation(client, ref, op)));
    print(argv, names.map((name, i) => ({ name, operation: ops[i].name, status: argv.wait ? 'DONE' : ops[i].status })));
}

const create = action({
    command: 'create [name]',
    describe: 'Create a Compute Engine instance',
    positionals: namePositional,
    options: {
        'machine-type': { type: 'string', alias: 'type', default: 'e2-micro', describe: 'Machine type' },
        image: { type: 'string', default: 'debian-12', describe: `Image or family path, or an alias (${Object.keys(IMAGE_ALIASES).join(', ')})` },
        'disk-size': { type: 'number', describe: 'Boot disk size in GB' },
        'startup-script': { type: 'string', describe: 'Startup script, inline or @file' },
        'public-ip': { type: 'boolean', default: true, describe: 'Assign an external IP (--no-public-ip to prevent it)' },
        ...labelsOption,
        ...zoneOption,
        ...waitOption,
    },
    examples: [['$0 gcp compute create web --type e2-small --image ubuntu-24.04 --wait', 'Create an instance and wait until it runs']],
    handler: async (argv) => {
        if (!argv.name) throw new Error('An instance name is required: clover gcp compute create <name>');
        const { client, ref } = context(argv);
        const op = await createInstance(client, ref, {
            name: argv.name,
            machineType: argv.machineType,
            image: argv.image,
            diskSize: argv.diskSize,
            startupScript: argv.startupScript ? readText(argv.startupScript) : undefined,
            publicIp: argv.publicIp,
            labels: parseKeyValues(argv.labels, 'label'),
        });
        info(`Creating ${argv.name} in ${ref.zone}.`);
        if (!argv.wait) return print(argv, { name: argv.name, operation: op.name, status: op.status });
        info('Waiting for the instance to run...');
        await waitForOperation(client, ref, op);
        const instance = await getInstance(client, ref, argv.name);
        print(argv, argv.output === 'json' ? instance : row(instance));
    },
});

const list = action({
    command: 'list',
    describe: 'List instances in every zone of the project',
    options: {
        state: { type: 'string', array: true, describe: 'Only these statuses, e.g. running terminated' },
        label: { type: 'string', array: true, describe: 'Only instances with this label (Key=Value, repeatable)' },
    },
    handler: async (argv) => {
        const { client, ref } = context(argv);
        const instances = await listInstances(client, ref.project, { statuses: argv.state?.map(String), labels: parseKeyValues(argv.label, 'label') });
        print(argv, argv.output === 'json' ? instances : instances.map(row), 'No instances found.');
    },
});

const get = action({
    command: 'get <name>',
    describe: 'Show one instance',
    positionals: namePositional,
    options: zoneOption,
    handler: async (argv) => {
        const { client, ref } = context(argv);
        print(argv, await getInstance(client, ref, argv.name));
    },
});

const update = action({
    command: 'update <name>',
    describe: 'Change an instance (machine type, labels, deletion protection)',
    positionals: namePositional,
    options: {
        'machine-type': { type: 'string', alias: 'type', describe: 'New machine type (the instance must be stopped, or use --restart)' },
        restart: { type: 'boolean', default: false, describe: 'Stop, resize and start the instance again when changing its machine type' },
        labels: { type: 'string', array: true, describe: 'Labels to add or change (Key=Value)' },
        'remove-labels': { type: 'string', array: true, describe: 'Label keys to remove' },
        'deletion-protection': { type: 'boolean', describe: 'Turn deletion protection on or off (--no-deletion-protection)' },
        ...zoneOption,
    },
    examples: [['$0 gcp compute update web --type e2-standard-2 --restart', 'Resize a running instance in one step']],
    handler: async (argv) => {
        const { client, ref } = context(argv);
        const instance = await updateInstance(client, ref, argv.name, {
            machineType: argv.machineType,
            restart: argv.restart,
            labels: parseKeyValues(argv.labels, 'label'),
            removeLabels: argv.removeLabels?.map(String),
            deletionProtection: argv.deletionProtection,
            onProgress: info,
        });
        info(`Updated ${argv.name}.`);
        print(argv, instance);
    },
});

const remove = action({
    command: 'delete <names..>',
    describe: 'Delete instance(s)',
    positionals: namesPositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Turn off deletion protection first' },
        ...zoneOption,
        ...yesOption,
        ...waitOption,
    },
    handler: async (argv) => {
        if (!await confirm(argv, `Delete ${argv.names.join(', ')}? This cannot be undone.`)) return;
        const { client, ref } = context(argv);
        await eachInstance(argv, client, ref, argv.names, (name) => deleteInstance(client, ref, name, { force: argv.force }));
    },
});

/** start, stop and reboot: one instance method per name. */
function power(command: string, method: string, describe: string): CommandModule {
    return action({
        command: `${command} <names..>`,
        describe,
        positionals: namesPositional,
        options: { ...zoneOption, ...waitOption },
        handler: async (argv) => {
            const { client, ref } = context(argv);
            await eachInstance(argv, client, ref, argv.names, (name) => instanceOp(client, ref, name, method));
        },
    });
}

/**
 * clover gcp compute <create|list|get|update|delete|start|stop|reboot>
 */
const computeCommand: CommandModule = {
    command: 'compute',
    describe: 'Create, list, update and delete Compute Engine instances',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(power('start', 'start', 'Start stopped instance(s)'))
        .command(power('stop', 'stop', 'Stop running instance(s)'))
        .command(power('reboot', 'reset', 'Reset (hard reboot) instance(s)'))
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, start, stop or reboot'),
    handler: () => {},
};

export default computeCommand;
