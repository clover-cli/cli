import { unsetCommand } from '../../credentials';

/**
 * clover aws logout
 * Prints the command that removes the credentials from the environment:
 *   eval "$(clover aws logout)"
 */
export function logout(): void {
    if (process.stdout.isTTY) {
        console.error('Run `eval "$(clover aws logout)"` to remove the credentials from your shell.');
    }
    console.log(unsetCommand());
}
