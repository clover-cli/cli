import { deleteAllAwsCredentials, deleteAwsCredentials, getAwsCredentials } from "../../db";
import { profileOption } from "./login";
import type {ArgumentsCamelCase, InferredOptionTypes, Options} from 'yargs';

/**
 * Defines the options available on the logout command.
 */
export const logoutOptions = {
    profile: profileOption,
    all: { type: 'boolean', default: false, describe: 'Delete every saved profile' },
} as const satisfies Record<string, Options>

// todo: completely understand what this is for and how to use appropiately
// ?? I've got a barebones idea that i definitely need to develop.
type LogoutArgs = ArgumentsCamelCase<InferredOptionTypes<typeof logoutOptions>>

export async function logout(argv: LogoutArgs): Promise<void> {
    if (argv.all) {
        // !! Add some further confirmation for this
        // todo: add an extra message that this action is irreversible
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
}