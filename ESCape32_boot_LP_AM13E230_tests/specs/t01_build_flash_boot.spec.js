'use strict';
/**
 * T1 - Build, flash and boot without fault
 * Validates concerns 4 (init order, startup, RAM_C ramfunc) and 2 (baseline app-area state).
 * Resources: jtag. Setup group G1.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');

const ID = 'T1';

describe('T1 - Build, flash and boot without fault', function () {
  before(async function () {
    // Steps 1-2: build the Debug configuration, flash the .out, halt + restart to the entry point.
    await fx.prepareTarget();
  });

  it('boots to the bootloader loop with no fault and RAM_C ramfunc copied', async function () {
    const A = cfg.addr;

    // Step 2 (repeat for the case run on its own): halt and restart to the entry point.
    dbg.restartToEntry();

    // Step 3: run for 3 s with no serial traffic, then halt.
    dbg.run();
    await fx.sleep(3000);
    dbg.halt();

    // Step 4: read PC, wrp_level, halfword at 0x1000, 64 B of RAM_C vs flash load image.
    const pc = dbg.readPC();
    const wrpLevel = fx.readWrpLevel();
    const appHalfword = dbg.readU16(A.appBase);
    const ramC = dbg.readBytes(A.ramfuncRun, 64);
    const ramfuncLoad = dbg.readBytes(A.ramfuncLoad, 64);

    fx.log(ID, `PC=${fx.h(pc)} wrp_level=${wrpLevel} halfword@0x1000=${fx.h(appHalfword, 4)}`);

    assert.ok(!fx.pcInDefaultHandler(pc), `PC ${fx.h(pc)} is in Default_Handler (fault)`);

    if (appHalfword === cfg.boot.appMagic) {
      // A stale app is present: the bootloader would have jumped. Report and continue (T5 clears it).
      fx.log(ID, 'stale app magic 0x32EA present at 0x1000 - bootloader handed off (T5 clears it)');
      assert.ok((pc & ~1) >= A.appVectors, `app magic present but PC ${fx.h(pc)} < 0x1800 (no hand-off)`);
    } else {
      assert.ok(fx.pcInBootloaderIdle(pc),
        `PC ${fx.h(pc)} is not in main (0x40-0x2AB) or recvbuf/recvval (0x4EC-0x53B / 0x6B6-0x6DD)`);
    }

    assert.deepEqual(ramC, ramfuncLoad,
      `RAM_C @0x00C18000 differs from the .TI.ramfunc load image @0x${A.ramfuncLoad.toString(16)} (first 64 bytes)\n` +
      `  RAM_C: ${ramC.toString('hex')}\n  flash: ${ramfuncLoad.toString('hex')}`);

    assert.ok([0, 1, 2].includes(wrpLevel), `wrp_level = ${wrpLevel}, expected 0, 1 or 2`);
    if (wrpLevel !== 0) fx.log(ID, `note: wrp_level is ${wrpLevel} (expected 0 on a fresh board)`);
  });

  // Teardown: none - the debug session stays open for the following cases.
});
