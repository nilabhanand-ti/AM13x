'use strict';
/**
 * Debug helper: target I/O over JTAG/SWD through the CCS scripting API, called
 * in-process (require() of {ccsInstall}/ccs/scripting/node_modules/scripting).
 *
 * The scripting API is synchronous (it blocks the Node event loop while a call is in
 * progress). Serial data that arrives meanwhile is buffered by the OS and delivered
 * once the call returns, so keep debugger calls out of tight serial-timing windows.
 *
 * Session lifetime: every case in this plan uses `jtag`, so one session is opened on
 * first use and held through the whole run; the root afterAll hook (lib/hooks.js)
 * calls shutdown().
 *
 * Board rules (LP-AM13E230 AGENTS.md + plan):
 *  - halt before restart/reset; restart to the entry point after loading;
 *  - never use the "System Reset" reset type (it disconnects the target);
 *  - never read SYSCTL RSTCAUSE (read-to-clear);
 *  - after a BOOTRST the connection may drop: refreshConnection(), do not reflash.
 */
const path = require('path');
const fs = require('fs');
const cfg = require('../config');

let scripting = null;
let ds = null;
let session = null;
let programLoaded = false;

function loadScripting() {
  if (!scripting) {
    const entry = path.join(cfg.ccsInstall, 'ccs', 'scripting', 'node_modules', 'scripting');
    scripting = require(entry);
  }
  return scripting;
}

function openSessionObject() {
  session = ds.openSession(cfg.corePattern);
  if (!session.target.isConnected()) session.target.connect();
}

/** Open (once) the scripting session to the Cortex-M33 core and connect. */
function open() {
  if (session) return session;
  const { initScripting } = loadScripting();
  fs.mkdirSync(cfg.resultsDir, { recursive: true });
  ds = initScripting({
    suppressMessages: !process.env.CCS_SCRIPTING_VERBOSE,
    logFile: path.join(cfg.resultsDir, 'scripting.log'),
  });
  ds.setScriptingTimeout(cfg.timing.scriptingTimeout);
  const { cores } = ds.configure(cfg.ccxml);
  console.log(`[debug] configured ${path.basename(cfg.ccxml)}; cores: ${cores.join(', ')}`);
  openSessionObject();
  return session;
}

function s() {
  return session || open();
}

function isOpen() {
  return session !== null;
}

function isProgramLoaded() {
  return programLoaded;
}

function halt() {
  const t = s().target;
  if (!t.isHalted()) t.halt();
}

/** Run without waiting for a halt. */
function run() {
  const t = s().target;
  if (t.isHalted()) t.run(false);
}

/** Halt (if running) and restart to the program entry point (Reset_Handler). */
function restartToEntry() {
  halt();
  s().target.restart();
}

/**
 * Flash the built .out once per session, then halt and restart to the entry point
 * (board known issue). Cross-checks the plan's symbol addresses against the image.
 */
function loadProgramOnce() {
  if (programLoaded) return;
  const sess = s();
  halt();
  ds.setScriptingTimeout(cfg.timing.loadTimeout);
  try {
    console.log(`[debug] loading ${cfg.outFile}`);
    sess.memory.loadProgram(cfg.outFile);
  } finally {
    ds.setScriptingTimeout(cfg.timing.scriptingTimeout);
  }
  restartToEntry();
  programLoaded = true;
  const mismatches = [];
  for (const [sym, expected] of Object.entries(cfg.symbolChecks)) {
    let actual = null;
    try { actual = sess.symbols.getAddress(sym); } catch (_) { actual = null; }
    if (actual !== null && (Number(actual) & ~1) !== expected) {
      mismatches.push(`${sym}: image 0x${Number(actual).toString(16)} vs config 0x${expected.toString(16)}`);
    }
  }
  if (mismatches.length) {
    throw new Error('Symbol addresses in the built image differ from config.js (update `addr` and ' +
      `\`symbolChecks\` from the Debug .map): ${mismatches.join('; ')}`);
  }
}

function readBytes(addr, count) {
  return Buffer.from(s().memory.read(addr, count, 8).map((v) => Number(v)));
}

function readU32(addr) {
  return Number(s().memory.readOne(addr, 32)) >>> 0;
}

function readU16(addr) {
  return Number(s().memory.readOne(addr, 16)) & 0xffff;
}

function readWords(addr, count) {
  return s().memory.read(addr, count, 32).map((v) => Number(v) >>> 0);
}

function readReg(name) {
  return Number(s().registers.read(name)) >>> 0;
}

function readPC() {
  return readReg('PC');
}

/** Read the main stack pointer; the register name depends on the TrustZone view. */
function readMSP() {
  const names = ['MSP', 'MSP_NS', 'MSP_S'];
  let lastErr;
  for (const n of names) {
    try { return { name: n, value: readReg(n) }; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** CPU-level reset (never "System Reset"). Target must be halted; it stays halted afterwards. */
function cpuReset() {
  halt();
  const t = s().target;
  const resets = t.getResets();
  let type = Object.keys(resets).find((k) => k === cfg.cpuResetType && resets[k]);
  if (!type) {
    type = Object.keys(resets).find((k) => /cpu/i.test(k) && k !== cfg.forbiddenResetType && resets[k]);
  }
  if (!type) {
    throw new Error(`No CPU-level reset available (resets: ${JSON.stringify(resets)}); refusing to use "${cfg.forbiddenResetType}"`);
  }
  t.reset(type);
  if (!t.isHalted()) t.halt();
}

/** Add a breakpoint at `location`, run until it is hit, remove it. */
function runToBreakpoint(location) {
  const sess = s();
  halt();
  const id = sess.breakpoints.add(location);
  try {
    sess.target.run(true);
  } finally {
    sess.breakpoints.remove(id);
  }
}

/**
 * After a BOOTRST the debug connection may be dropped. Reconnect, or as a last
 * resort re-open the session and reload symbols only (never reflash).
 * Returns 'ok' | 'reconnected' | 'reopened'. The target is halted afterwards.
 */
function refreshConnection() {
  const probe = () => { halt(); readU32(cfg.addr.wrpLevel); };
  // Always force a disconnect/connect, even when the target still reports "connected": a firmware
  // BOOTRST resets the core debug logic behind the debugger's back. Verified on hardware (T9):
  // afterwards FPB_CTRL.ENABLE = 0 (so restart()/run-to-main never halts -> scripting timeout) and
  // multi-word memory reads return word 0 repeated (AP address auto-increment lost). A reconnect
  // makes CCS re-initialise both (FPB_CTRL 0x10000080 -> 0x10000081, block reads correct).
  try {
    s();
    try { session.target.disconnect(); } catch (_) { /* ignore */ }
    session.target.connect();
    probe();
    return 'reconnected';
  } catch (_) { /* fall through */ }
  try { session.close(); } catch (_) { /* ignore */ }
  try { ds.deconfigure(); } catch (_) { /* ignore */ }
  ds.configure(cfg.ccxml);
  openSessionObject();
  session.symbols.load(cfg.outFile);
  probe();
  return 'reopened';
}

/** Tear the scripting session down (root afterAll hook). */
function shutdown() {
  if (!ds) return;
  try { if (session) session.close(); } catch (_) { /* ignore */ }
  try { ds.shutdown(); } catch (_) { /* ignore */ }
  ds = null;
  session = null;
  programLoaded = false;
}

module.exports = {
  open, isOpen, isProgramLoaded, loadProgramOnce, halt, run, restartToEntry, cpuReset,
  runToBreakpoint, refreshConnection, shutdown,
  readBytes, readU32, readU16, readWords, readReg, readPC, readMSP,
  session: s,
};
