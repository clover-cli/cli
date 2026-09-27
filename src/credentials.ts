import type { AwsLogin } from './provider/aws';

/**
 * AWS credentials come from the standard AWS environment variables,
 * the same ones the AWS CLI and SDKs read.
 */
export const AWS_ENV_VARS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION'] as const;

export const DEFAULT_REGION = 'us-east-1';

/**
 * Reads the credentials from the environment.
 * Returns undefined when the access key or secret is missing.
 * The region falls back to AWS_DEFAULT_REGION, then us-east-1.
 */
export function readAwsEnv(env: NodeJS.ProcessEnv = process.env): AwsLogin | undefined {
    const accessKeyId = env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
        return undefined;
    }
    return {
        accessKeyId,
        secretAccessKey,
        sessionToken: env.AWS_SESSION_TOKEN || undefined,
        region: env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_REGION,
    };
}

/** Wraps a value in single quotes so the shell takes it literally. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shell commands that put the credentials in the environment, meant for:
 *   eval "$(clover aws login)"
 * Without a session token, any old AWS_SESSION_TOKEN is unset so it doesn't break the new keys.
 */
export function exportCommands(login: AwsLogin): string[] {
    return [
        `export AWS_ACCESS_KEY_ID=${shellQuote(login.accessKeyId)}`,
        `export AWS_SECRET_ACCESS_KEY=${shellQuote(login.secretAccessKey)}`,
        login.sessionToken
            ? `export AWS_SESSION_TOKEN=${shellQuote(login.sessionToken)}`
            : 'unset AWS_SESSION_TOKEN',
        `export AWS_REGION=${shellQuote(login.region)}`,
    ];
}

/** Shell command that removes the credentials from the environment: eval "$(clover aws logout)" */
export function unsetCommand(): string {
    return `unset ${AWS_ENV_VARS.join(' ')}`;
}
