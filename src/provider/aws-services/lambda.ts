import {
    CreateFunctionCommand,
    DeleteFunctionCommand,
    GetFunctionCommand,
    InvokeCommand,
    LambdaClient,
    ListFunctionsCommand,
    TagResourceCommand,
    UpdateFunctionCodeCommand,
    UpdateFunctionConfigurationCommand,
    waitUntilFunctionActiveV2,
    waitUntilFunctionUpdatedV2,
    type Architecture,
    type FunctionConfiguration as LambdaFunctionConfiguration,
    type Runtime,
} from '@aws-sdk/client-lambda';
import type { AwsClientConfig } from '../aws';
import { MAX_WAIT_SECONDS } from './common';
import { loadCode } from './zip';

/**
 * Lambda functions: create, read, update (configuration and code), delete, plus invoke.
 */

export function lambdaClient(config: AwsClientConfig): LambdaClient {
    return new LambdaClient(config);
}

export interface LambdaFunctionSummary {
    name: string;
    runtime?: string;
    handler?: string;
    memoryMb?: number;
    timeoutSec?: number;
    architecture?: string;
    state?: string;
    lastUpdate?: string;
    modified?: string;
    role?: string;
    environment?: Record<string, string>;
    arn?: string;
}

/**
 * This method takes the lambda config and presents it as a summary
 * @param fn A lambda function configuration
 * @returns An object representing the summary of the lambda function
 */
function summarize(fn: LambdaFunctionConfiguration): LambdaFunctionSummary {
    return {
        name: fn.FunctionName ?? 'unknown',
        runtime: fn.Runtime,
        handler: fn.Handler,
        memoryMb: fn.MemorySize,
        timeoutSec: fn.Timeout,
        architecture: fn.Architectures?.[0],
        state: fn.State,
        lastUpdate: fn.LastUpdateStatus,
        modified: fn.LastModified,
        role: fn.Role,
        environment: fn.Environment?.Variables,
        arn: fn.FunctionArn,
    };
}

export interface FunctionCreateOptions {
    role: string;
    /** A .zip file, or a file/folder that is zipped automatically. */
    code: string;
    runtime: string;
    handler: string;
    memory?: number;
    timeout?: number;
    architecture?: Architecture;
    description?: string;
    environment?: Record<string, string>;
    tags?: Record<string, string>;
}

export async function createFunction(client: LambdaClient, name: string, opts: FunctionCreateOptions): Promise<LambdaFunctionSummary> {
    const result = await client.send(new CreateFunctionCommand({
        FunctionName: name,
        Role: opts.role,
        Code: { ZipFile: loadCode(opts.code) },
        // Any runtime is passed through; AWS validates it, even ones newer than the SDK's list.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        Runtime: opts.runtime as Runtime,
        Handler: opts.handler,
        MemorySize: opts.memory,
        Timeout: opts.timeout,
        Architectures: opts.architecture ? [opts.architecture] : undefined,
        Description: opts.description,
        Environment: opts.environment ? { Variables: opts.environment } : undefined,
        Tags: opts.tags,
    }));
    return summarize(result);
}

export async function listFunctions(client: LambdaClient): Promise<LambdaFunctionSummary[]> {
    const functions: LambdaFunctionSummary[] = [];
    let marker: string | undefined;
    do {
        const page = await client.send(new ListFunctionsCommand({ Marker: marker }));
        functions.push(...(page.Functions ?? []).map(summarize));
        marker = page.NextMarker;
    } while (marker);
    return functions;
}

export async function getFunction(client: LambdaClient, name: string): Promise<LambdaFunctionSummary> {
    const result = await client.send(new GetFunctionCommand({ FunctionName: name }));
    if (!result.Configuration) throw new Error(`Function ${name} not found.`);
    return summarize(result.Configuration);
}

export interface FunctionUpdateOptions {
    code?: string;
    runtime?: string;
    handler?: string;
    memory?: number;
    timeout?: number;
    role?: string;
    description?: string;
    /** Merged into the current variables. */
    environment?: Record<string, string>;
    removeEnvironment?: string[];
    tags?: Record<string, string>;
}

/**
 * This method is responsible for updating an existing lambda function with new options.
 * @param client The lambda client object
 * @param name The name of the function itself.
 * @param opts The new options / config
 * @returns A promise with a summary of the function's new properties
 */
export async function updateFunction(client: LambdaClient, name: string, opts: FunctionUpdateOptions): Promise<LambdaFunctionSummary> {
    const { code, tags, environment, removeEnvironment, ...config } = opts;
    const changesEnv = environment !== undefined || removeEnvironment !== undefined;

    if (changesEnv || Object.values(config).some((v) => v !== undefined)) {
        let variables: Record<string, string> | undefined;
        if (changesEnv) {
            // The API replaces all variables, so start from the current ones.
            variables = { ...(await getFunction(client, name)).environment, ...environment };
            for (const key of removeEnvironment ?? []) delete variables[key];
        }
        await client.send(new UpdateFunctionConfigurationCommand({
            FunctionName: name,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- passed through for AWS to validate, as in createFunction
            Runtime: config.runtime as Runtime | undefined,
            Handler: config.handler,
            MemorySize: config.memory,
            Timeout: config.timeout,
            Role: config.role,
            Description: config.description,
            Environment: variables ? { Variables: variables } : undefined,
        }));
        // A function accepts one update at a time; wait before sending the code.
        if (code) await waitForFunction(client, name, 'updated');
    }

    if (code) {
        await client.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: loadCode(code) }));
    }

    const fn = await getFunction(client, name);
    if (tags && Object.keys(tags).length > 0) {
        await client.send(new TagResourceCommand({ Resource: fn.arn, Tags: tags }));
    }
    return fn;
}

/**
 * Deletes a Lambda function, including all of its versions.
 * @param client The lambda client object
 * @param name The name of the function we want to remove
 */
export async function deleteFunction(client: LambdaClient, name: string): Promise<void> {
    await client.send(new DeleteFunctionCommand({ FunctionName: name }));
}

export interface InvokeResult {
    statusCode?: number;
    /** Set when the function threw; the payload then holds the error. */
    error?: string;
    payload: unknown;
    /** Last 4 KB of the logs, when requested. */
    logs?: string;
}

export async function invokeFunction(
    client: LambdaClient, name: string, { payload, logs = false, async = false }: { payload?: unknown; logs?: boolean; async?: boolean } = {},
): Promise<InvokeResult> {
    const result = await client.send(new InvokeCommand({
        FunctionName: name,
        InvocationType: async ? 'Event' : 'RequestResponse',
        LogType: logs && !async ? 'Tail' : undefined,
        Payload: payload === undefined ? undefined : Buffer.from(JSON.stringify(payload)),
    }));
    const text = result.Payload ? Buffer.from(result.Payload).toString('utf8') : '';
    let parsed: unknown = text;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    } catch {
        // Not JSON: keep the raw text.
    }
    return {
        statusCode: result.StatusCode,
        error: result.FunctionError,
        payload: parsed,
        logs: result.LogResult ? Buffer.from(result.LogResult, 'base64').toString('utf8') : undefined,
    };
}

export async function waitForFunction(client: LambdaClient, name: string, state: 'active' | 'updated'): Promise<void> {
    const waiter = state === 'active' ? waitUntilFunctionActiveV2 : waitUntilFunctionUpdatedV2;
    await waiter({ client, maxWaitTime: MAX_WAIT_SECONDS }, { FunctionName: name });
}
