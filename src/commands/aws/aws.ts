import type { Argv, ArgumentsCamelCase, CommandModule, InferredOptionTypes, Options } from 'yargs';
import {
    deleteAllAwsCredentials,
    deleteAwsCredentials,
    getAwsCredentials,
    listAwsCredentials,
} from '../../db';
import { getAwsClientConfig, verifyAwsCredentials } from '../../provider/aws';
import { mask } from '../../utils';
import { profileOption, login, loginOptions } from './login';
import { logout, logoutOptions } from './logout';

/**
 * This method identifies and logs out the information of a given profile.
 * @param profile The user's profile information
 */
async function whoami(profile: string) {
    try {
        const { region, credentials } = getAwsClientConfig(profile);
        const identity = await verifyAwsCredentials({ ...credentials, region });
        console.log(`Profile "${profile}": ${identity.arn} (account ${identity.accountId}, region ${region})`);
    } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
    }
}

/**
 * This method lists on the console a list of the current available AWS Credentials
 */
function listProfiles() {
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
}

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
            builder: (y: Argv) => y.options(loginOptions),
            handler: login,
        })
        .command({
            command: 'list',
            describe: 'List saved AWS profiles',
            handler: () => {
                listProfiles();
            },
        })
        .command({
            command: 'whoami',
            describe: 'Check that a saved profile still works',
            builder: (y: Argv) => y.options({ profile: profileOption }),
            handler: async (argv) => {
                const profile = argv.profile as string;
                whoami(profile);
            },
        })
        .command({
            command: 'logout',
            describe: 'Delete saved AWS credentials',
            builder: (y: Argv) => y.options(logoutOptions),
            handler: logout,
        })
        .demandCommand(1, 'Choose an action: login, list, whoami or logout'),
    handler: () => {},
};

export default awsCommand;
