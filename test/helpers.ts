import { vi } from 'vitest';
import yargs from 'yargs';
import awsCommand from '../src/commands/aws/aws';

/**
 * Runs the CLI with the given arguments, e.g. runCli('aws logout --all').
 * Mirrors src/args.ts, but throws on errors instead of exiting the process.
 */
export async function runCli(args: string): Promise<void> {
    await yargs(args.split(' '))
        .scriptName('clover')
        .command(awsCommand)
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
