import readline from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Ask the user a question in the terminal.
 * With `hidden: true` the typed characters are not echoed (useful for secrets).
 * The question is written to stderr, so stdout stays clean for `eval "$(clover aws login)"`.
 */
export function askUser(question: string, { hidden: hideInput = false } = {}): Promise<string> {
    // Hidden input echoes into a muted stream; the question and final newline go straight to stderr.
    const output = hideInput ? new Writable({ write: (_chunk, _encoding, done) => done() }) : process.stderr;
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    if (hideInput) process.stderr.write(question);

    return new Promise((resolve) => {
        rl.question(hideInput ? '' : question, (answer) => {
            rl.close();
            if (hideInput) process.stderr.write('\n');
            resolve(answer.trim());
        });
    });
}

/** The message of a caught error, whatever was thrown. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Show only the last 4 characters of a secret, e.g. "****************WXYZ". */
export function mask(value: string): string {
    if (value.length <= 4) {
        return '****'
    }
    // Repeat * per char + the last 4 characters
    return "*".repeat(value.length - 4) + value.slice(-4);
}
