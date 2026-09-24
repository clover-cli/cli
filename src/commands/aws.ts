import type { Argv, CommandModule } from 'yargs';
import {
    deleteAllAwsCredentials,
    deleteAwsCredentials,
    getAwsCredentials,
    listAwsCredentials,
    saveAwsCredentials,
} from '../db';
import { getAwsClientConfig, verifyAwsCredentials } from '../provider/aws';
import { askUser, mask } from '../utils';

const profileOption = {
    type: 'string',
    default: 'default',
    describe: 'Name to store the credentials under',
} as const;

/**
 * clover aws <login|list|whoami|logout>
 */
const awsCommand: CommandModule = {
    command: 'aws',
    describe: 'Manage AWS credentials',
    builder: (yargs: Argv) => yargs
        .command({
            command: 'login',
            describe: 'Connect to AWS and save the credentials',
            builder: (y: Argv) => y.options({
                profile: profileOption,
                'access-key-id': { type: 'string', describe: 'AWS access key ID' },
                'secret-access-key': { type: 'string', describe: 'AWS secret access key' },
                'session-token': { type: 'string', describe: 'Session token (only for temporary credentials)' },
                region: { type: 'string', describe: 'Default AWS region, e.g. us-east-1' },
            }),
            handler: async (argv) => {
                // Anything not given as a flag is asked interactively.
                const accessKeyId = (argv['access-key-id'] as string | undefined) || await askUser('AWS Access Key ID: ');
                const secretAccessKey = (argv['secret-access-key'] as string | undefined) || await askUser('AWS Secret Access Key: ', { hidden: true });
                const region = (argv.region as string | undefined) || await askUser('Region [us-east-1]: ') || 'us-east-1';
                const sessionToken = argv['session-token'] as string | undefined;
                const profile = argv.profile as string;

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
            },
        })
        .command({
            command: 'list',
            describe: 'List saved AWS profiles',
            handler: () => {
                const rows = listAwsCredentials();
                if (rows.length === 0) {
                    console.log('No AWS credentials saved. Run: clover aws login');
                    return;
                }
                console.table(rows.map((r) => ({
                    profile: r.profile,
                    accessKeyId: mask(r.access_key_id),
                    region: r.region,
                    account: r.account_id,
                    savedAt: r.created_at,
                })));
            },
        })
        .command({
            command: 'whoami',
            describe: 'Check that a saved profile still works',
            builder: (y: Argv) => y.options({ profile: profileOption }),
            handler: async (argv) => {
                const profile = argv.profile as string;
                try {
                    const { region, credentials } = getAwsClientConfig(profile);
                    const identity = await verifyAwsCredentials({ ...credentials, region });
                    console.log(`Profile "${profile}": ${identity.arn} (account ${identity.accountId}, region ${region})`);
                } catch (err) {
                    console.error((err as Error).message);
                    process.exitCode = 1;
                }
            },
        })
        .command({
            command: 'logout',
            describe: 'Delete saved AWS credentials',
            builder: (y: Argv) => y.options({
                profile: profileOption,
                all: { type: 'boolean', default: false, describe: 'Delete every saved profile' },
            }),
            handler: (argv) => {
                if (argv.all) {
                    const count = deleteAllAwsCredentials();
                    console.log(`Deleted ${count} AWS profile(s).`);
                    return;
                }
                const profile = argv.profile as string;
                if (!getAwsCredentials(profile)) {
                    console.log(`No credentials saved for profile "${profile}".`);
                    return;
                }
                deleteAwsCredentials(profile);
                console.log(`Deleted AWS credentials for profile "${profile}".`);
            },
        })
        .demandCommand(1, 'Choose an action: login, list, whoami or logout'),
    handler: () => {},
};

export default awsCommand;
