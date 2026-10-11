'use strict';
/**
 * Runs Mocha under the CCS-bundled Node.js ({ccsInstall}/ccs/tools/node/node.exe),
 * falling back to the current Node if it is not found. Extra CLI args go to Mocha.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cfg = require('../config');

const testsDir = path.resolve(__dirname, '..');
const ccsNode = path.join(cfg.ccsInstall, 'ccs', 'tools', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const node = fs.existsSync(ccsNode) ? ccsNode : process.execPath;
const mochaBin = require.resolve('mocha/bin/mocha.js', { paths: [testsDir] });

fs.mkdirSync(cfg.resultsDir, { recursive: true });
console.log(`[run-mocha] ${node} ${path.relative(testsDir, mochaBin)} ${process.argv.slice(2).join(' ')}`);
const child = spawn(node, [mochaBin, ...process.argv.slice(2)], { stdio: 'inherit', cwd: testsDir });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
