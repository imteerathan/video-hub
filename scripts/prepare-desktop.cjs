const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const source = path.join(root, 'node_modules', '.prisma');
const target = path.join(root, '.next', 'standalone', 'node_modules', '.prisma');

if (!fs.existsSync(source)) {
  throw new Error('Generated Prisma artifacts were not found at node_modules/.prisma');
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true, force: true });

const clientSource = path.join(root, 'node_modules', '@prisma', 'client');
const clientTarget = path.join(root, '.next', 'standalone', 'node_modules', '@prisma', 'client');
if (!fs.existsSync(clientSource)) {
  throw new Error('Prisma Client was not generated at node_modules/@prisma/client');
}
fs.mkdirSync(path.dirname(clientTarget), { recursive: true });
fs.cpSync(clientSource, clientTarget, { recursive: true, force: true });

console.log('Desktop Prisma artifacts prepared for standalone packaging.');
console.log({ source, target, clientTarget });
