import argv from './args';

/**
 * Example use case:
 * node dist/index.js --message Example
 * >Example
 */
if (argv.message) {
    console.log(argv.message);
}