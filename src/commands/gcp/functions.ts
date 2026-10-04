import type { Argv, CommandModule } from 'yargs';
import {
    createFunction,
    deleteFunction,
    getFunction,
    invokeFunction,
    listFunctions,
    updateFunction,
    waitForOperation,
    type FunctionsLocation,
    type Operation,
} from '../../provider/gcp-services/functions';
import { action, confirm, info, parseJson, parseKeyValues, print, waitOption, yesOption } from '../aws/shared';
import type { GcpClient } from '../../provider/gcp';
import { DEFAULT_GCP_REGION, gcpContext, gcpServiceBuilder } from './shared';

const namePositional = { name: { type: 'string', describe: 'Function name' } } as const;
const labelsOption = { labels: { type: 'string', array: true, describe: 'Labels as Key=Value (repeatable)' } } as const;

/** The client and the function's project and region. action() types argv with the AWS options, so --project is read by name. */
function context(argv: { region?: string; [key: string]: unknown }): { client: GcpClient; where: FunctionsLocation } {
    const { client, project } = gcpContext({ project: argv.project });
    return { client, where: { project, region: argv.region ?? DEFAULT_GCP_REGION } };
}

/** With --wait, waits for the operation and prints the function; otherwise prints the operation. */
async function finish(argv: { wait: boolean; output: string; region?: string; name: string; [key: string]: unknown }, op: Operation): Promise<void> {
    const { client, where } = context(argv);
    if (!argv.wait) {
        print(argv, { name: argv.name, operation: op.name });
        return;
    }
    info('Waiting for the deployment to finish...');
    await waitForOperation(client, op);
    print(argv, await getFunction(client, where, argv.name));
}

const create = action({
    command: 'create <name>',
    describe: 'Deploy a Cloud Function',
    positionals: namePositional,
    options: {
        source: { type: 'string', demandOption: true, describe: 'A .zip file, or a file/folder to zip automatically' },
        runtime: { type: 'string', default: 'nodejs22', describe: 'Runtime, e.g. nodejs22, python313' },
        'entry-point': { type: 'string', describe: 'Exported function to call (defaults to the name)' },
        memory: { type: 'number', describe: 'Memory in MB' },
        timeout: { type: 'number', describe: 'Timeout in seconds' },
        description: { type: 'string', describe: 'Description' },
        env: { type: 'string', array: true, describe: 'Environment variables as KEY=VALUE (repeatable)' },
        ...labelsOption,
        ...waitOption,
    },
    examples: [
        ['$0 gcp functions create hello --source index.js --entry-point hello --wait', 'Zip one file and deploy it'],
        ['$0 gcp functions create api --source ./build --runtime python313 --entry-point main --env STAGE=prod', 'Deploy a folder'],
    ],
    handler: async (argv) => {
        const { client, where } = context(argv);
        const env = parseKeyValues(argv.env, 'environment variable');
        const labels = parseKeyValues(argv.labels, 'label');
        const op = await createFunction(client, where, argv.name, {
            source: argv.source,
            runtime: argv.runtime,
            entryPoint: argv.entryPoint ?? argv.name,
            memory: argv.memory,
            timeout: argv.timeout,
            description: argv.description,
            environment: Object.keys(env).length > 0 ? env : undefined,
            labels: Object.keys(labels).length > 0 ? labels : undefined,
        });
        await finish(argv, op);
    },
});

const list = action({
    command: 'list',
    describe: 'List Cloud Functions',
    handler: async (argv) => {
        const { client, where } = context(argv);
        const fns = await listFunctions(client, where);
        print(argv, argv.output === 'json' ? fns : fns.map(({ name, runtime, memory, state, updated }) => ({
            name, runtime, memory, state, updated,
        })), 'No functions found.');
    },
});

const get = action({
    command: 'get <name>',
    describe: 'Show one Cloud Function',
    positionals: namePositional,
    handler: async (argv) => {
        const { client, where } = context(argv);
        print(argv, await getFunction(client, where, argv.name));
    },
});

const update = action({
    command: 'update <name>',
    describe: 'Change a Cloud Function\'s source and/or configuration',
    positionals: namePositional,
    options: {
        source: { type: 'string', describe: 'New source: a .zip file, or a file/folder to zip' },
        runtime: { type: 'string', describe: 'New runtime' },
        'entry-point': { type: 'string', describe: 'New entry point' },
        memory: { type: 'number', describe: 'Memory in MB' },
        timeout: { type: 'number', describe: 'Timeout in seconds' },
        description: { type: 'string', describe: 'New description' },
        env: { type: 'string', array: true, describe: 'Set environment variables (KEY=VALUE); others are kept' },
        'remove-env': { type: 'string', array: true, describe: 'Environment variable names to remove' },
        ...labelsOption,
        ...waitOption,
    },
    examples: [['$0 gcp functions update api --source ./build --memory 512 --env LOG_LEVEL=debug --wait', 'Deploy new source and settings together']],
    handler: async (argv) => {
        const { client, where } = context(argv);
        const env = parseKeyValues(argv.env, 'environment variable');
        const op = await updateFunction(client, where, argv.name, {
            source: argv.source,
            runtime: argv.runtime,
            entryPoint: argv.entryPoint,
            memory: argv.memory,
            timeout: argv.timeout,
            description: argv.description,
            environment: Object.keys(env).length > 0 ? env : undefined,
            removeEnvironment: argv.removeEnv?.map(String),
            labels: parseKeyValues(argv.labels, 'label'),
        });
        if (!op) throw new Error('Nothing to update. Pass --source or an option to change.');
        await finish(argv, op);
    },
});

const remove = action({
    command: 'delete <name>',
    describe: 'Delete a Cloud Function',
    positionals: namePositional,
    options: yesOption,
    handler: async (argv) => {
        if (!await confirm(argv, `Delete function ${argv.name}?`)) return;
        const { client, where } = context(argv);
        await deleteFunction(client, where, argv.name);
        info(`Deleting ${argv.name}.`);
    },
});

const invoke = action({
    command: 'invoke <name>',
    describe: 'Call a Cloud Function over HTTP and print what it returns',
    positionals: namePositional,
    options: {
        payload: { type: 'string', describe: 'Request body as JSON, or @file.json' },
    },
    examples: [[`$0 gcp functions invoke hello --payload '{"name":"Ada"}'`, 'Call a function with a JSON body']],
    handler: async (argv) => {
        const { client, where } = context(argv);
        const result = await invokeFunction(client, where, argv.name,
            argv.payload ? parseJson(argv.payload, '--payload') : undefined);
        if (result !== undefined && result !== '') print({ output: 'json' }, result);
    },
});

/**
 * clover gcp functions <create|list|get|update|delete|invoke>
 */
const functionsCommand: CommandModule = {
    command: 'functions',
    describe: 'Create, list, update, delete and invoke Cloud Functions',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(invoke)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete or invoke'),
    handler: () => {},
};

export default functionsCommand;
