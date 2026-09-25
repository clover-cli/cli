import type { Argv, ArgumentsCamelCase, CommandModule, InferredOptionTypes, Options } from 'yargs';
import { askUser } from '../../utils';
import { verifyAwsCredentials } from '../../provider/aws';
import { saveAwsCredentials } from '../../db';

export const profileOption = {
    type: 'string',
    default: 'default',
    describe: 'Name to store the credentials under',
} as const;

export const loginOptions = {
    profile: profileOption,
    'access-key-id': { type: 'string', describe: 'AWS access key ID' },
    'secret-access-key': { type: 'string', describe: 'AWS secret access key' },
    'session-token': { type: 'string', describe: 'Session token (only for temporary credentials)' },
    region: { type: 'string', describe: 'Default AWS region, e.g. us-east-1' },
} as const satisfies Record<string, Options>;

/** Typed argv for `clover aws login`, derived from `loginOptions`. */
type LoginArgs = ArgumentsCamelCase<InferredOptionTypes<typeof loginOptions>>;

/**
 * clover aws login
 * Anything not given as a flag is asked interactively.
 */
export async function login(argv: LoginArgs): Promise<void> {
    const accessKeyId = argv.accessKeyId || await askUser('AWS Access Key ID: ');
    const secretAccessKey = argv.secretAccessKey || await askUser('AWS Secret Access Key: ', { hidden: true });
    const region = argv.region || await askUser('Region [us-east-1]: ') || 'us-east-1';
    const { sessionToken, profile } = argv;

    if (!accessKeyId || !secretAccessKey) {
        console.error('Access Key ID and Secret Access Key are required.');
        process.exitCode = 1;
        return;
    }

    console.log('Verifying credentials with AWS...');
    let identity;
    try {
        identity = await verifyAwsCredentials({ accessKeyId, secretAccessKey, sessionToken, region });
    } catch (err) {
        console.error(`Could not connect to AWS: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
    }

    saveAwsCredentials({
        profile,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        session_token: sessionToken ?? null,
        region,
        account_id: identity.accountId,
        arn: identity.arn,
    });

    console.log(`Connected as ${identity.arn} (account ${identity.accountId}).`);
    console.log(`Credentials saved under profile "${profile}".`);
}