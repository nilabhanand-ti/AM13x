'use strict';
/**
 * T7 - 500 ms per-byte SysTick timeout
 * Validates concern 7. Resources: jtag, serial. Setup group G2.
 * Precondition: no app at 0x1000 (state left by T5).
 */
const assert = require('node:assert/strict');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, hex } = require('../lib/protocol');

const ID = 'T7';

describe('T7 - 500 ms per-byte SysTick timeout', function () {
  let ser;

  before(async function () {
    await fx.prepareTarget();
    ({ ser } = await fx.prepareSerial());
  });

  it('accepts a 300 ms inter-byte gap, drops an 800 ms gap, and keeps running', async function () {
    // Step 1: bootloader running with no app at 0x1000. Flush.
    fx.assertNoAppMagic(ID);
    await fx.startBootloader(ser);

    // Step 2: within the timeout: 00, wait 300 ms, FF; collect 300 ms.
    await ser.write([0x00]);
    await fx.sleep(300);
    await ser.write([0xff]);
    const step2 = await ser.collect(300);

    // Step 3: idle 1.2 s, flush.
    await fx.sleep(1200);
    await ser.flush();

    // Step 4: past the timeout: 00, wait 800 ms, FF; collect 300 ms.
    await ser.write([0x00]);
    await fx.sleep(800);
    await ser.write([0xff]);
    const step4 = await ser.collect(300);

    // Step 5: idle 1.2 s, flush, PROBE.
    await fx.sleep(1200);
    await ser.flush();
    await ser.write([0x00, 0xff]);
    const step5 = await ser.collect(300);

    // Step 6: halt and check PC.
    dbg.halt();
    const pc = dbg.readPC();
    fx.log(ID, `step2=${hex(step2)} step4=${hex(step4)} step5=${hex(step5)} PC=${fx.h(pc)}`);

    assert.ok(step2.equals(RES_OK), `step 2 (300 ms gap) returned ${hex(step2)}, expected 00 ff`);
    assert.equal(step4.length, 0, `step 4 (800 ms gap) returned ${hex(step4)}, expected nothing`);
    assert.ok(step5.equals(RES_OK), `step 5 PROBE returned ${hex(step5)}, expected 00 ff`);
    assert.ok(!fx.pcInDefaultHandler(pc), `PC ${fx.h(pc)} is in Default_Handler`);
    assert.ok((pc & ~1) < 0x1000, `PC ${fx.h(pc)} is not < 0x1000 (left the bootloader)`);
  });
});
