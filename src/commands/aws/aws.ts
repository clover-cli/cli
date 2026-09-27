import type { Argv, CommandModule } from 'yargs';
import { getAwsClientConfig, verifyAwsCredentials } from '../../provider/aws';
import { login, loginOptions } from './login';
import { logout } from './logout';
import { listResources } from './resources';

/**
 * Checks the credentials in the environment against AWS and prints who they belong to.
 */
async function whoami() {
    try {
        const { region, credentials } = getAwsClientConfig();
        const identity = await verifyAwsCredentials({ ...credentials, region });
        console.log(`${identity.arn} (account ${identity.accountId}, region ${region})`);
    } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
    }
}

/**
 * clover aws <login|whoami|logout|list-resources>
 */
const awsCommand: CommandModule = {
    command: 'aws',
    describe: 'Manage AWS credentials',
    builder: (yargs: Argv) => yargs
        .command({
            command: 'login',
            describe: 'Verify AWS credentials and print the commands to export them',
            builder: (y: Argv) => y.options(loginOptions),
            handler: login,
        })
        .command({
            command: 'whoami',
            describe: 'Check that the credentials in the environment work',
            handler: whoami,
        })
        .command({
            command: 'logout',
            describe: 'Print the command to remove AWS credentials from the environment',
            handler: logout,
        })
        .command({
            command: 'list-resources',
            describe: 'List available and used resources within AWS',
            handler: listResources,
        })
        .demandCommand(1, 'Choose an action: login, whoami, logout or list-resources'),
    handler: () => {},
};

export default awsCommand;
