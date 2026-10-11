'use strict';
/**
 * Case-level helpers shared by the specs: setup (build -> flash), starting the
 * bootloader within the 200 ms window, and common target-state readers.
 */
const cfg = require('../config');
const build = require('./build');
const dbg = require('./debug');
const { sharedSerial, sleep } = require('./serial');
const { Bootloader } = require('./protocol');

const h = (v, width = 8) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(width, '0')}`;

function log(caseId, msg) {
  console.log(`      [${caseId}] ${msg}`);
}

/**
 * Case setup: build the project (headless CCS CLI), then make sure the built image is
 * flashed in the (shared) debug session. Flashing happens once per run - the first
 * case to run flashes; later cases reuse the target state the plan sequence relies on.
 */
async function prepareTarget() {
  await build.buildOnce();
  dbg.open();
  dbg.loadProgramOnce();
}

/** Open (once) the shared COM6 connection and return it with a protocol wrapper. */
async function prepareSerial() {
  const ser = await sharedSerial();
  return { ser, boot: new Bootloader(ser) };
}

/**
 * Start the bootloader and get ready to send the first command:
 *  restart=true  -> halt, restart to Reset_Handler, run (plan: "restart and run")
 *  restart=false -> just resume a halted core ("run again")
 * then flush RX (drops an optional boot ACK) - all well inside the 200 ms budget.
 */
async function startBootloader(ser, { restart = true } = {}) {
  if (restart) dbg.restartToEntry();
  dbg.run();
  await sleep(cfg.timing.postRunSettle);
  await ser.flush();
}

/** CPU-level reset (never System Reset), run, settle, flush. */
async function resetAndRun(ser) {
  dbg.cpuReset();
  dbg.run();
  await sleep(cfg.timing.postRunSettle);
  await ser.flush();
}

/** Halt and fail fast if an app image (magic 0x32EA at 0x1000) is present. */
function assertNoAppMagic(caseId) {
  dbg.halt();
  const hw = dbg.readU16(cfg.addr.appBase);
  if (hw === cfg.boot.appMagic) {
    throw new Error(`${caseId} precondition failed: app magic 0x32EA is present at 0x1000. ` +
      'This case expects the T5 state (non-magic pattern at 0x1000) - run the sequence from T5.');
  }
  return hw;
}

function pcInDefaultHandler(pc) {
  const a = pc & ~1;
  return a >= cfg.addr.defaultHandler && a <= cfg.addr.defaultHandlerEnd;
}

function pcInBootloaderIdle(pc) {
  const a = pc & ~1;
  const A = cfg.addr;
  return (a >= A.main && a <= A.mainEnd) || (a >= A.recvbuf && a <= A.recvbufEnd) || (a >= A.recvval && a <= A.recvvalEnd);
}

function pcInTestApp(pc) {
  const a = pc & ~1;
  return a >= 0x1808 && a <= 0x180b;
}

/** First free 16-byte slot of the WRP record page (null slot => page full, next write erases to 0x7F800). */
function findFreeWrpSlot() {
  const words = dbg.readWords(cfg.addr.wrpPage, cfg.addr.wrpPageSize / 4);
  for (let i = 0; i < words.length; i += 4) {
    if (words[i] === 0xffffffff) return { addr: cfg.addr.wrpPage + i * 4, full: false };
  }
  return { addr: cfg.addr.wrpPage, full: true };
}

function readWrpSlot(addr) {
  return dbg.readWords(addr, 4);
}

function readWrpLevel() {
  return dbg.readU32(cfg.addr.wrpLevel) | 0;
}

function readWeprot() {
  return {
    A0: dbg.readU32(cfg.reg.GSC_FPC_WEPROTA0),
    A1: dbg.readU32(cfg.reg.GSC_FPC_WEPROTA1),
    B0: dbg.readU32(cfg.reg.GSC_FPC_WEPROTB0),
    B1: dbg.readU32(cfg.reg.GSC_FPC_WEPROTB1),
  };
}

const fmtWeprot = (w) => `A0=${h(w.A0)} A1=${h(w.A1)} B0=${h(w.B0)} B1=${h(w.B1)}`;
const fmtWords = (ws) => `{${ws.map((w) => h(w)).join(', ')}}`;

module.exports = {
  h, log, prepareTarget, prepareSerial, startBootloader, resetAndRun, assertNoAppMagic,
  pcInDefaultHandler, pcInBootloaderIdle, pcInTestApp, findFreeWrpSlot, readWrpSlot, readWrpLevel,
  readWeprot, fmtWeprot, fmtWords, sleep,
};
