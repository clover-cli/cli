# Clover CLI

In development...

## AWS

Credentials are checked against AWS (STS `GetCallerIdentity`) and saved in `db/cred.sqlite`.

```bash
npm run build

node dist/index.js aws login                    # prompts for key, secret and region
node dist/index.js aws login --profile work \
  --access-key-id AKIA... --secret-access-key ... --region us-east-1

node dist/index.js aws list                     # show saved profiles (keys masked)
node dist/index.js aws whoami --profile work    # check a saved profile still works

node dist/index.js aws logout                   # delete the "default" profile
node dist/index.js aws logout --profile work    # delete one profile
node dist/index.js aws logout --all             # delete every profile
```

To use a saved profile with any AWS SDK client in code:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { getAwsClientConfig } from './provider/aws';

const s3 = new S3Client(getAwsClientConfig('work'));
```
