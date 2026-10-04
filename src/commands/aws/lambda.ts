import type { Argv, CommandModule } from 'yargs';
import {
    createFunction,
    deleteFunction,
    getFunction,
    invokeFunction,
    lambdaClient,
    listFunctions,
    updateFunction,
    waitForFunction,
} from '../../provider/aws-services/lambda';
import { action, createTags, clientConfig, confirm, info, parseJson, parseKeyValues, print, serviceBuilder, tagsOption, waitOption, yesOption } from './shared';

const namePositional = { name: { type: 'string', describe: 'Function name' } } as const;

const create = action({
    command: 'create <name>',
    describe: 'Create a Lambda function',
    positionals: namePositional,
    options: {
        code: { type: 'string', demandOption: true, describe: 'A .zip file, or a file/folder to zip automatically' },
        role: { type: 'string', demandOption: true, describe: 'ARN of the IAM role the function runs as' },
        runtime: { type: 'string', default: 'nodejs22.x', describe: 'Runtime, e.g. nodejs22.x, python3.13' },
        handler: { type: 'string', default: 'index.handler', describe: 'file.function to call' },
        memory: { type: 'number', describe: 'Memory in MB (128-10240)' },
        timeout: { type: 'number', describe: 'Timeout in seconds (max 900)' },
        architecture: { choices: ['x86_64', 'arm64'] as const, describe: 'CPU architecture' },
        description: { type: 'string', describe: 'Description' },
        env: { type: 'string', array: true, describe: 'Environment variables as KEY=VALUE (repeatable)' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [
        ['$0 aws lambda create hello --code index.mjs --role arn:aws:iam::123456789012:role/lambda-basic --wait', 'Zip one file and deploy it'],
        ['$0 aws lambda create api --code ./build --runtime python3.13 --handler app.handler --env STAGE=prod', 'Deploy a folder'],
    ],
    handler: async (argv) => {
        const client = lambdaClient(clientConfig(argv));
        const env = parseKeyValues(argv.env, 'environment variable');
        let fn = await createFunction(client, argv.name, {
            code: argv.code,
            role: argv.role,
            runtime: argv.runtime,
            handler: argv.handler,
            memory: argv.memory,
            timeout: argv.timeout,
            architecture: argv.architecture,
            description: argv.description,
            environment: Object.keys(env).length > 0 ? env : undefined,
            tags: createTags(argv),
        });
        if (argv.wait) {
            info('Waiting for the function to become active...');
            await waitForFunction(client, argv.name, 'active');
            fn = await getFunction(client, argv.name);
        }
        print(argv, fn);
    },
});

const list = action({
    command: 'list',
    describe: 'List Lambda functions',
    handler: async (argv) => {
        const fns = await listFunctions(lambdaClient(clientConfig(argv)));
        print(argv, argv.output === 'json' ? fns : fns.map(({ name, runtime, memoryMb, timeoutSec, modified }) => ({
            name, runtime, memoryMb, timeoutSec, modified,
        })), 'No functions found.');
    },
});

const get = action({
    command: 'get <name>',
    describe: 'Show one Lambda function',
    positionals: namePositional,
    handler: async (argv) => {
        print(argv, await getFunction(lambdaClient(clientConfig(argv)), argv.name));
    },
});

const update = action({
    command: 'update <name>',
    describe: 'Change a Lambda function\'s code and/or configuration',
    positionals: namePositional,
    options: {
        code: { type: 'string', describe: 'New code: a .zip file, or a file/folder to zip' },
        runtime: { type: 'string', describe: 'New runtime' },
        handler: { type: 'string', describe: 'New handler' },
        memory: { type: 'number', describe: 'Memory in MB' },
        timeout: { type: 'number', describe: 'Timeout in seconds' },
        role: { type: 'string', describe: 'New IAM role ARN' },
        description: { type: 'string', describe: 'New description' },
        env: { type: 'string', array: true, describe: 'Set environment variables (KEY=VALUE); others are kept' },
        'remove-env': { type: 'string', array: true, describe: 'Environment variable names to remove' },
        ...tagsOption,
        ...waitOption,
    },
    examples: [['$0 aws lambda update api --code ./build --memory 512 --env LOG_LEVEL=debug --wait', 'Deploy new code and settings together']],
    handler: async (argv) => {
        const client = lambdaClient(clientConfig(argv));
        const env = parseKeyValues(argv.env, 'environment variable');
        let fn = await updateFunction(client, argv.name, {
            code: argv.code,
            runtime: argv.runtime,
            handler: argv.handler,
            memory: argv.memory,
            timeout: argv.timeout,
            role: argv.role,
            description: argv.description,
            environment: Object.keys(env).length > 0 ? env : undefined,
            removeEnvironment: argv.removeEnv?.map(String),
            tags: parseKeyValues(argv.tags),
        });
        if (argv.wait) {
            info('Waiting for the update to finish...');
            await waitForFunction(client, argv.name, 'updated');
            fn = await getFunction(client, argv.name);
        }
        print(argv, fn);
    },
});

const remove = action({
    command: 'delete <name>',
    describe: 'Delete a Lambda function',
    positionals: namePositional,
    options: yesOption,
    handler: async (argv) => {
        if (!await confirm(argv, `Delete function ${argv.name}?`)) return;
        await deleteFunction(lambdaClient(clientConfig(argv)), argv.name);
        info(`Deleted ${argv.name}.`);
    },
});

const invoke = action({
    command: 'invoke <name>',
    describe: 'Run a Lambda function and print what it returns',
    positionals: namePositional,
    options: {
        payload: { type: 'string', describe: 'Event as JSON, or @file.json' },
        logs: { type: 'boolean', default: false, describe: 'Also print the end of the logs' },
        async: { type: 'boolean', default: false, describe: 'Queue the event and return right away' },
    },
    examples: [[`$0 aws lambda invoke hello --payload '{"name":"Ada"}' --logs`, 'Call a function with an event']],
    handler: async (argv) => {
        const result = await invokeFunction(lambdaClient(clientConfig(argv)), argv.name, {
            payload: argv.payload ? parseJson(argv.payload, '--payload') : undefined,
            logs: argv.logs,
            async: argv.async,
        });
        if (result.logs) info(result.logs.trimEnd());
        if (argv.async) {
            info(`Queued (status ${result.statusCode}).`);
            return;
        }
        if (result.error) {
            console.error(`Function error: ${result.error}`);
            process.exitCode = 1;
        }
        if (argv.output === 'json') print(argv, result);
        else if (result.payload !== undefined) print({ output: 'json' }, result.payload);
    },
});

/**
 * clover aws lambda <create|list|get|update|delete|invoke>
 */
const lambdaCommand: CommandModule = {
    command: 'lambda',
    describe: 'Create, list, update, delete and invoke Lambda functions',
    builder: (yargs: Argv) => serviceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(invoke)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete or invoke'),
    handler: () => {},
};

export default lambdaCommand;
