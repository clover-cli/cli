import readline from 'node:readline';

/**
 * Ask the user a question in the terminal.
 * With `hidden: true` the typed characters are not echoed (useful for secrets).
 */
export function askUser(question: string, { hidden: hideInput = false } = {}): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    if (hideInput) {
        // Swallow echoed characters, but still print the question itself.
        const output = rl as unknown as { _writeToOutput: (s: string) => void };
        output._writeToOutput = (s: string) => {
            if (s.startsWith(question)) process.stdout.write(question);
            else if (s.includes('\n') || s.includes('\r')) process.stdout.write('\n');
        };
    }

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/** Show only the last 4 characters of a secret, e.g. "****************WXYZ". */
export function mask(value: string): string {
    return value.length <= 4 ? '****' : '*'.repeat(value.length - 4) + value.slice(-4);
}
