import path from 'path';
console.log('Current directory:', process.cwd());
console.log('Test path would be:', path.join(process.cwd(), '..', 'cli-validation', 'test-project', 'projection-rules.yaml'));
