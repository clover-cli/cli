import type { ArgumentsCamelCase, Argv, CommandModule, InferredOptionTypes, Options } from 'yargs';
import { getGcpConfig, verifyGcpCredentials } from '../../provider/gcp';
import { gcpExportCommands, gcpUnsetCommand } from '../../credentials';
import { askUser, errorMessage } from '../../utils';
import computeCommand from './compute';
import sqlCommand from './sql';
import firestoreCommand from './firestore';
import storageCommand from './storage';
import functionsCommand from './functions';
import iamCommand from './iam';
import { listResources } from './resources';
import { gcpCommonOptions } from './shared';

const loginOptions = {
    project: { type: 'string', describe: 'GCP project ID' },
    'key-file': { type: 'string', describe: 'Service account key file (omit to use gcloud application-default credentials)' },
} as const satisfies Record<string, Options>;

/**
 * clover gcp login
 * Asks for anything not given as a flag, checks the credentials, then prints the `export`
 * commands for: eval "$(clover gcp login)". Everything else goes to stderr.
 */
async function login(argv: ArgumentsCamelCase<InferredOptionTypes<typeof loginOptions>>): Promise<void> {
    const project = argv.project || await askUser('GCP project ID: ');
    const keyFile = argv.keyFile ?? (await askUser('Service account key file [application default]: ') || undefined);
    if (!project) {
        console.error('A project ID is required.');
        process.exitCode = 1;
        return;
    }

    console.error('Verifying credentials with GCP...');
    let identity;
    try {
        identity = await verifyGcpCredentials({ project, keyFile });
    } catch (err) {
        console.error(`Could not connect to GCP: ${errorMessage(err)}`);
        process.exitCode = 1;
        return;
    }

    console.error(`Connected as ${identity.email ?? 'application default credentials'} (project ${project}).`);
    if (process.stdout.isTTY) {
        console.error('Run `eval "$(clover gcp login)"` to load these credentials into your shell.');
    }
    for (const line of gcpExportCommands({ project, keyFile })) {
        console.log(line);
    }
}

/** clover gcp whoami: checks the credentials in the environment. */
async function whoami(): Promise<void> {
    try {
        const identity = await verifyGcpCredentials(getGcpConfig());
        console.log(`${identity.email ?? 'application default credentials'} (project ${identity.project})`);
    } catch (err) {
        console.error(errorMessage(err));
        process.exitCode = 1;
    }
}

/** clover gcp logout: prints the command that removes the GCP variables. */
function logout(): void {
    if (process.stdout.isTTY) {
        console.error('Run `eval "$(clover gcp logout)"` to remove the credentials from your shell.');
    }
    console.log(gcpUnsetCommand());
}

/**
 * clover gcp <login|whoami|logout|compute|sql|firestore|storage|functions|iam|list-resources>
 */
const gcpCommand: CommandModule = {
    command: 'gcp',
    describe: 'Manage GCP credentials and resources',
    builder: (yargs: Argv) => yargs
        .command({
            command: 'login',
            describe: 'Verify GCP credentials and print the commands to export them',
            builder: (y: Argv) => y.options(loginOptions),
            handler: login,
        })
        .command({ command: 'whoami', describe: 'Check that the credentials in the environment work', handler: whoami })
        .command({ command: 'logout', describe: 'Print the command to remove GCP credentials from the environment', handler: logout })
        .command(computeCommand)
        .command(sqlCommand)
        .command(firestoreCommand)
        .command(storageCommand)
        .command(functionsCommand)
        .command(iamCommand)
        .command({
            command: 'list-resources',
            describe: 'List every resource in the project (Cloud Asset Inventory)',
            builder: (y: Argv) => y.options({ project: gcpCommonOptions.project }),
            handler: listResources,
        })
        .demandCommand(1, 'Choose an action: login, whoami, logout, compute, sql, firestore, storage, functions, iam, list-resources'),
    handler: () => {},
};

export default gcpCommand;
