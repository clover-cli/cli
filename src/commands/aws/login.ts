import type { ArgumentsCamelCase, InferredOptionTypes, Options } from 'yargs';
import { askUser, errorMessage } from '../../utils';
import { verifyAwsCredentials } from '../../provider/aws';
import { DEFAULT_REGION, exportCommands } from '../../credentials';

export const loginOptions = {
    'access-key-id': { type: 'string', describe: 'AWS access key ID' },
    'secret-access-key': { type: 'string', describe: 'AWS secret access key' },
    'session-token': { type: 'string', describe: 'Session token (only for temporary credentials)' },
    region: { type: 'string', describe: 'Default AWS region, e.g. us-east-1' },
} as const satisfies Record<string, Options>;

/** Typed argv for `clover aws login`, derived from `loginOptions`. */
type LoginArgs = ArgumentsCamelCase<InferredOptionTypes<typeof loginOptions>>;

/**
 * clover aws login
 * Anything not given as a flag is asked interactively. Once AWS accepts the credentials,
 * the `export` commands are printed to stdout, so the shell can load them with:
 *   eval "$(clover aws login)"
 * Everything else goes to stderr so it isn't captured by the eval.
 */
export async function login(argv: LoginArgs): Promise<void> {
    const accessKeyId = argv.accessKeyId || await askUser('AWS Access Key ID: ');
    const secretAccessKey = argv.secretAccessKey || await askUser('AWS Secret Access Key: ', { hidden: true });
    const region = argv.region || await askUser(`Region [${DEFAULT_REGION}]: `) || DEFAULT_REGION;
    const { sessionToken } = argv;

    if (!accessKeyId || !secretAccessKey) {
        console.error('Access Key ID and Secret Access Key are required.');
        process.exitCode = 1;
        return;
    }

    console.error('Verifying credentials with AWS...');
    let identity;
    try {
        identity = await verifyAwsCredentials({ accessKeyId, secretAccessKey, sessionToken, region });
    } catch (err) {
        console.error(`Could not connect to AWS: ${errorMessage(err)}`);
        process.exitCode = 1;
        return;
    }

    console.error(`Connected as ${identity.arn} (account ${identity.accountId}).`);
    if (process.stdout.isTTY) {
        console.error('Run `eval "$(clover aws login)"` to load these credentials into your shell.');
    }
    for (const line of exportCommands({ accessKeyId, secretAccessKey, sessionToken, region })) {
        console.log(line);
    }
}
