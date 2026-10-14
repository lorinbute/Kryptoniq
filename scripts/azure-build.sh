#!/usr/bin/env bash
# The build on Azure App Service (deploy-azure.md §3, TD-AZURE §11): Oryx runs it instead of its own `npm install` +
# `npm run build`, through the app setting CUSTOM_BUILD_COMMAND="bash scripts/azure-build.sh".
set -euo pipefail

# With NODE_ENV=production npm leaves out the devDependencies, and the web build needs them (vite, react, tailwind).
# onnxruntime-node would also fetch its CUDA files on Linux x64 (hundreds of MB); Sentiq's model runs on the CPU.
export ONNXRUNTIME_NODE_INSTALL=skip
npm ci --include=dev --no-audit --no-fund
npm run build
# The server needs only the dependencies; fewer files to unpack at every start.
npm prune --omit=dev --no-audit --no-fund
