'use strict';
/**
 * Build helper: drives the CCS headless CLI (ccs-server-cli.bat / .sh).
 *
 * Exactly these flags are used: -workspace, -application projectBuild,
 * -ccs.locations <project dir>, -ccs.autoImport, -ccs.configuration <buildConfig>,
 * -ccs.listProblems. The plan's "Debug" configuration is built explicitly.
 *
 * stdout/stderr are streamed to the console and parsed; any error throws.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cfg = require('../config');

function cliPath() {
  const name = process.platform === 'win32' ? 'ccs-server-cli.bat' : 'ccs-server-cli.sh';
  return path.join(cfg.ccsInstall, 'ccs', 'eclipse', name);
}

/** Parse the headless build output; returns a list of error descriptions (empty = OK). */
function parseBuildOutput(output, exitCode) {
  const errors = [];
  if (exitCode !== 0) errors.push(`ccs-server-cli exited with code ${exitCode}`);

  if (/CCS headless build failed to run to completion/.test(output)) {
    errors.push('CCS headless build failed to run to completion');
  }
  if (/was not found in the workspace/.test(output)) {
    errors.push(`project '${cfg.projectName}' was not found in workspace '${cfg.workspace}'`);
  }
  if (/Only one (concurrent )?CLI command/.test(output)) {
    errors.push('another CCS CLI command is already running against this workspace');
  }
  const complete = /CCS headless build complete - (\d+) out of (\d+) projects have errors/.exec(output);
  if (!complete) {
    errors.push('no "CCS headless build complete" line in the build output');
  } else if (Number(complete[1]) > 0) {
    errors.push(`${complete[1]} of ${complete[2]} projects have errors`);
  }
  const summaryRe = /Problem summary for project '([^']+)': (\d+) errors, (\d+) warnings/g;
  let m;
  while ((m = summaryRe.exec(output)) !== null) {
    if (Number(m[2]) > 0) errors.push(`problem summary for '${m[1]}': ${m[2]} errors, ${m[3]} warnings`);
  }
  // Compiler / linker / make error lines (tiarmclang "x.c:1:2: error:", TI "error #nnn:", gmake "*** ... Error n").
  for (const line of output.split(/\r?\n/)) {
    if (/(^|[\s:])(fatal )?error( #\S+)?:/i.test(line) || /gmake(\[\d+\])?: \*\*\*.*Error \d+/.test(line)) {
      errors.push(line.trim());
    }
  }
  return errors;
}

/** Run one headless build. Resolves with the output, rejects with every error found. */
function runBuild() {
  return new Promise((resolve, reject) => {
    const cli = cliPath();
    if (!fs.existsSync(cli)) {
      reject(new Error(`BuildFailed: ccs-server-cli not found at ${cli} (set CCS_INSTALL_DIR)`));
      return;
    }
    const args = [
      '-workspace', cfg.workspace,
      '-application', 'projectBuild',
      // The CCS Theia IDE workspace has no headless (Eclipse) project metadata, so
      // "-ccs.projects <name>" reports "project not found" (even with -ccs.autoImport).
      // Address the project by location and let the CLI import it in place.
      '-ccs.locations', cfg.projectDir,
      '-ccs.autoImport',
      // Build the plan's configuration explicitly instead of relying on the active one.
      '-ccs.configuration', cfg.buildConfig,
      '-ccs.listProblems',
    ];
    const isWin = process.platform === 'win32';
    // A .bat file can only be spawned through a shell on Windows; quote every argument.
    const q = (s) => (isWin ? `"${s}"` : s);
    console.log(`[build] ${cli} ${args.join(' ')}`);
    const child = spawn(isWin ? q(cli) : cli, isWin ? args.map(q) : args, { shell: isWin, cwd: cfg.workspace });
    let output = '';
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
    child.on('error', (err) => reject(new Error(`BuildFailed: could not start ccs-server-cli: ${err.message}`)));
    child.on('close', (code) => {
      const errors = parseBuildOutput(output, code);
      if (errors.length) {
        reject(new Error(`BuildFailed: ${cfg.projectName}\n  - ${errors.join('\n  - ')}`));
        return;
      }
      if (!fs.existsSync(cfg.outFile)) {
        reject(new Error(`BuildFailed: build reported success but ${cfg.outFile} does not exist ` +
          `(is "${cfg.buildConfig}" the active build configuration?)`));
        return;
      }
      resolve(output);
    });
  });
}

let buildPromise = null;
/**
 * Build the project. Every case calls this in its setup before flashing; the
 * headless build runs once per test run and later callers share its result
 * (an incremental rebuild of unchanged sources would be a no-op anyway).
 */
function buildOnce() {
  if (!buildPromise) buildPromise = runBuild();
  return buildPromise;
}

module.exports = { buildOnce, runBuild, parseBuildOutput, cliPath };
