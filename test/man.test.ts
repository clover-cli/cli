import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AWS_ENV_VARS } from '../src/credentials';
import { loginOptions } from '../src/commands/aws/login';
import pkg from '../package.json';

/** The man page is written by hand, so these checks catch it falling behind the code. */
const man = readFileSync(path.resolve(__dirname, '..', 'man', 'clover.1'), 'utf8');

/** Strips roff escapes so "\-\-region" reads as "--region". */
const text = man.replace(/\\-/g, '-');

describe('man/clover.1', () => {
    it('documents every aws command', () => {
        for (const command of ['login', 'whoami', 'list-resources', 'logout']) {
            expect(text).toContain(`.B aws ${command}`);
        }
    });

    it('documents every login option', () => {
        for (const option of Object.keys(loginOptions)) {
            expect(text).toContain(`--${option}`);
        }
    });

    it('documents every environment variable', () => {
        for (const name of [...AWS_ENV_VARS, 'AWS_DEFAULT_REGION']) {
            expect(text).toContain(`.B ${name}`);
        }
    });

    it('is published with the package', () => {
        expect(pkg.man).toContain('./man/clover.1');
        expect(pkg.files).toContain('man');
    });
});
