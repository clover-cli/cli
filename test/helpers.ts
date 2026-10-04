import { vi, type Mock } from 'vitest';
import yargs from 'yargs';
import awsCommand from '../src/commands/aws/aws';
import type { GcpClient } from '../src/provider/gcp';
import gcpCommand from '../src/commands/gcp/gcp';

/**
 * Runs the CLI with the given arguments, e.g. runCli('aws logout --all').
 * Pass an array when an argument contains spaces, e.g. runCli(['aws', 'ddb', 'put-item', 't', '--item', '{"a": 1}']).
 * Mirrors src/args.ts, but throws on errors instead of exiting the process.
 */
export async function runCli(args: string | string[]): Promise<void> {
    await yargs(typeof args === 'string' ? args.split(' ') : args)
        .scriptName('clover')
        .command(awsCommand)
        .command(gcpCommand)
        .strict()
        .exitProcess(false)
        .fail((msg, err) => {
            throw err ?? new Error(msg);
        })
        .parseAsync();
}

/** Everything printed with console.log, one call per line. */
export function logged(): string {
    return vi.mocked(console.log).mock.calls.map((args) => args.join(' ')).join('\n');
}

/** Everything printed with console.error, one call per line. */
export function errored(): string {
    return vi.mocked(console.error).mock.calls.map((args) => args.join(' ')).join('\n');
}

/** A command sent to a fake AWS client: its class name and input. */
export interface SentCommand {
    name: string;
    input: Record<string, unknown>;
}

/**
 * A stand-in for an AWS SDK client. `responses` maps a command's class name
 * (e.g. 'RunInstancesCommand') to what `send` resolves with; a function is called with the input,
 * and an array is used one entry per call (the last entry repeats).
 */
// T is only returned: it names the SDK client the fake stands in for.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function fakeClient<T>(responses: Record<string, unknown> = {}): { client: T; send: Mock; sent: () => SentCommand[] } {
    const counts = new Map<string, number>();
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const name = command.constructor.name;
        let response = responses[name];
        if (Array.isArray(response)) {
            const n = counts.get(name) ?? 0;
            counts.set(name, n + 1);
            response = response[Math.min(n, response.length - 1)];
        }
        if (typeof response === 'function') response = await response(command.input);
        if (response instanceof Error) throw response;
        return response ?? {};
    });
    const sent = () => send.mock.calls.map(([c]) => ({ name: c.constructor.name, input: c.input }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake with only `send` stands in for the real client
    return { client: { send } as unknown as T, send, sent };
}

/** Sets the credentials that getAwsClientConfig returns. */
export const testConfig = { region: 'us-east-1', credentials: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET' } };

/** A request sent to a fake GCP client. */
export interface SentRequest {
    method: string;
    url: string;
    params?: Record<string, unknown>;
    data?: unknown;
}

/**
 * A stand-in for the GCP client (see GcpClient in src/provider/gcp.ts). `responses` maps
 * "METHOD url-substring" (e.g. 'POST /instances') to the response body; the first key that matches
 * wins. A function is called with the request, an array is used one entry per call (the last repeats),
 * and an Error is thrown.
 */
export function fakeGcpClient(responses: Record<string, unknown> = {}) {
    const counts = new Map<string, number>();
    const request = vi.fn(async (opts: SentRequest) => {
        const key = Object.keys(responses).find((k) => {
            const [method, part] = k.split(' ');
            return method === (opts.method ?? 'GET') && opts.url.includes(part);
        });
        let response = key === undefined ? undefined : responses[key];
        if (key !== undefined && Array.isArray(response)) {
            const n = counts.get(key) ?? 0;
            counts.set(key, n + 1);
            response = response[Math.min(n, response.length - 1)];
        }
        if (typeof response === 'function') response = await response(opts);
        if (response instanceof Error) throw response;
        return { data: response ?? {} };
    });
    const sent = (): SentRequest[] => request.mock.calls.map(([opts]) => opts);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake with only `request` stands in for GoogleAuth
    return { client: { request } as unknown as GcpClient, request, sent };
}
