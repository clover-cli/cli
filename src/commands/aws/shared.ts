import { readFileSync } from 'node:fs';
import type { ArgumentsCamelCase, Argv, CommandModule, InferredOptionTypes, Options, PositionalOptions } from 'yargs';
import { askUser } from '../../utils';
import { getAwsClientConfig, type AwsClientConfig } from '../../provider/aws';

/**
 * Helpers shared by the per-service commands (clover aws ec2|rds|dynamodb|s3|lambda ...).
 */

/** Options every service command accepts. */
export const commonOptions = {
    region: { type: 'string', describe: 'Region for this command (overrides AWS_REGION)' },
    output: { choices: ['table', 'json'] as const, default: 'table' as const, describe: 'Output format' },
} as const satisfies Record<string, Options>;

export const yesOption = {
    yes: { type: 'boolean', alias: 'y', default: false, describe: 'Skip the confirmation prompt' },
} as const satisfies Record<string, Options>;

export const waitOption = {
    wait: { type: 'boolean', default: false, describe: 'Wait until AWS finishes the operation' },
} as const satisfies Record<string, Options>;

export const tagsOption = {
    tags: { type: 'string', array: true, describe: 'Tags as Key=Value (repeatable)' },
} as const satisfies Record<string, Options>;

export type Args<O extends Record<string, Options>> =
    ArgumentsCamelCase<InferredOptionTypes<O & typeof commonOptions>>;

/** `<id>` is a string, `<ids..>` (declared with array: true) a list of strings. */
type PositionalArgs<P extends Record<string, PositionalOptions>> =
    { [K in keyof P]: P[K] extends { array: true } ? string[] : string };

/**
 * Adds the options shared by every action of a service, including --config,
 * which loads any option from a JSON file (flags given on the command line win).
 */
export function serviceBuilder(yargs: Argv): Argv {
    return yargs
        .options(commonOptions)
        .config('config', 'JSON file with options for this command (flags override it)');
}

/**
 * Defines one action, e.g. `clover aws ec2 create`.
 * Errors thrown by the handler are printed and set exit code 1.
 */
export function action<
    const O extends Record<string, Options> = Record<never, Options>,
    const P extends Record<string, PositionalOptions> = Record<never, PositionalOptions>,
>(spec: {
    command: string;
    describe: string;
    options?: O;
    positionals?: P;
    examples?: [string, string][];
    handler: (argv: Args<O> & PositionalArgs<P>) => Promise<void>;
}): CommandModule {
    return {
        command: spec.command,
        describe: spec.describe,
        builder: (y: Argv) => {
            for (const [name, opts] of Object.entries(spec.positionals ?? {})) {
                y = y.positional(name, opts);
            }
            for (const [cmd, desc] of spec.examples ?? []) {
                y = y.example(cmd, desc);
            }
            return y.options(spec.options ?? {});
        },
        handler: async (argv) => {
            try {
                await spec.handler(argv as unknown as Args<O> & PositionalArgs<P>);
            } catch (err) {
                console.error((err as Error).message);
                process.exitCode = 1;
            }
        },
    };
}

/** SDK client config from the environment, with the --region override applied. */
export function clientConfig(argv: { region?: string }): AwsClientConfig {
    const config = getAwsClientConfig();
    return argv.region ? { ...config, region: argv.region } : config;
}

/** Parses ["Key=Value", ...] into an object. The value may contain "=". */
export function parseKeyValues(list: readonly (string | number)[] | undefined, label = 'tag'): Record<string, string> {
    const result: Record<string, string> = {};
    for (const item of list ?? []) {
        const text = String(item);
        const eq = text.indexOf('=');
        if (eq <= 0) {
            throw new Error(`Invalid ${label} "${text}". Use Key=Value.`);
        }
        result[text.slice(0, eq)] = text.slice(eq + 1);
    }
    return result;
}

/** A value given inline, or read from a file with the @path prefix (e.g. --user-data @setup.sh). */
export function readText(value: string): string {
    return value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value;
}

/** Parses JSON given inline, or from a file with the @path prefix (e.g. --item @item.json). */
export function parseJson(value: string, label: string): unknown {
    const text = readText(value);
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`Invalid JSON for ${label}: ${(err as Error).message}`, { cause: err });
    }
}

/**
 * Asks before a destructive action. --yes skips the prompt.
 * Without a terminal to ask in, --yes is required.
 */
export async function confirm(argv: { yes?: boolean }, message: string): Promise<boolean> {
    if (argv.yes) return true;
    if (!process.stdin.isTTY) {
        throw new Error(`${message} Pass --yes to confirm when not running in a terminal.`);
    }
    const answer = await askUser(`${message} [y/N] `);
    if (/^y(es)?$/i.test(answer)) return true;
    console.error('Cancelled.');
    return false;
}

/** Status messages go to stderr so stdout stays clean for --output json. */
export function info(message: string): void {
    console.error(message);
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Prints a result: a list as a table, an object as "key  value" lines, or raw JSON with --output json.
 */
export function print(argv: { output?: string }, value: unknown, empty = 'Nothing found.'): void {
    if (argv.output === 'json') {
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) console.log(empty);
        else console.table(value);
        return;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, v]) => v !== undefined);
        const width = Math.max(...entries.map(([k]) => k.length));
        for (const [key, v] of entries) {
            console.log(`${key.padEnd(width)}  ${formatValue(v)}`);
        }
        return;
    }
    console.log(formatValue(value));
}
