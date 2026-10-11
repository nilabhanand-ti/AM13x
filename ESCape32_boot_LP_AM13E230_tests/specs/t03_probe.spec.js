'use strict';
/**
 * T3 - CMD_PROBE over the XDS110 backchannel
 * Validates concerns 5, 4. Resources: jtag, serial (COM6, 38400 8N1, raw). Setup group G2.
 */
const assert = require('node:assert/strict');
const fx = require('../lib/fixture');
const { RES_OK, hex } = require('../lib/protocol');

const ID = 'T3';

describe('T3 - CMD_PROBE over the XDS110 backchannel', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    // Step 1: open COM6 (38400 8N1, raw).
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('answers every PROBE with exactly 00 FF within 100 ms', async function () {
    // Step 2: restart to the entry point and run; within 200 ms flush RX (drops an optional boot ACK).
    await fx.startBootloader(ser);

    // Step 3: PROBE; step 4: repeat PROBE 20 times back to back.
    const results = [];
    for (let i = 0; i < 21; i++) {
      const resp = await boot.probe(100);
      results.push(resp);
    }
    const stray = await ser.collect(50);

    const okCount = results.filter((r) => r.equals(RES_OK)).length;
    fx.log(ID, `${okCount}/${results.length} PROBEs answered 00 FF; stray bytes: ${hex(stray)}`);

    if (results.every((r) => r.length === 0)) {
      assert.fail('No response at all on COM6. Likely cause: J12 TX/RX shunts not fitted, or a Rev E1 board ' +
        '(silkscreen MCU178E1) without the PA0/PA1 jumper-wire workaround (J4-38 -> J12-TX, J4-39 -> J12-RX).');
    }
    results.forEach((r, i) => assert.ok(r.equals(RES_OK), `PROBE #${i + 1} returned ${hex(r)}, expected 00 ff`));
    assert.equal(stray.length, 0, `unexpected extra bytes after the PROBEs: ${hex(stray)}`);
  });
});
