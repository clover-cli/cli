import argv from './args';

/**
 * Example use case:
 * node dist/index.js --message Example
 * >Example
 *
 * AWS:
 * node dist/index.js aws login
 */
Promise.resolve(argv).then((args) => {
    if (args.message) {
        console.log(args.message);
    }
});
