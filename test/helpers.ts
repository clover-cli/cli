import { vi, type Mock } from 'vitest';
import yargs from 'yargs';
import awsCommand from '../src/commands/aws/aws';
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
