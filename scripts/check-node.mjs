// Fails early with a clear message when Node is too old to run the TypeScript sources natively.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`Kryptoniq needs Node.js 24 or newer (found ${process.versions.node}). Install it from https://nodejs.org or with Homebrew: brew install node`);
  process.exit(1);
}
