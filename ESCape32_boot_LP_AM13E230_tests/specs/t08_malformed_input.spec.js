'use strict';
/**
 * T8 - Malformed input is rejected without corrupting flash or crashing
 * Validates concerns 6, 7, 2. Resources: jtag, serial. Setup group G2.
 * Precondition: no app at 0x1000; the READ at the end expects the T5 pattern P0.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, CMD, value, block, hex } = require('../lib/protocol');
const { P0, BAD_CRC_DATA } = require('../lib/patterns');

const ID = 'T8';

describe('T8 - Malformed input is rejected without corrupting flash or crashing', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('ignores a bad complement, a bad CRC and an unknown command', async function () {
    // Step 1: bootloader running with no app (after T5). Flush.
    fx.assertNoAppMagic(ID);
    const before0x1000 = dbg.readBytes(cfg.addr.appBase, 0x400);
    await fx.startBootloader(ser);

    // Step 2: bad complement 00 00, wait 700 ms, then PROBE.
    await ser.write([0x00, 0x00]);
    const silent2 = await ser.collect(700);
    const probe2 = await boot.probe();

    // Step 3: WRITE num=0, 1024 x 0x5A with CRC XOR 1, wait 700 ms, then PROBE.
    await ser.write(Buffer.concat([value(CMD.WRITE), value(0), block(BAD_CRC_DATA, { crcXor: 1 })]));
    const silent3 = await ser.collect(700);
    const probe3 = await boot.probe();

    // Step 4: unknown command 07 F8, wait 700 ms, then PROBE.
    await ser.write([0x07, 0xf8]);
    const silent4 = await ser.collect(700);
    const probe4 = await boot.probe();

    // Step 5: READ num=0 cnt=255.
    const r = await boot.read(0, 255);

    // Step 6: halt and check PC.
    dbg.halt();
    const pc = dbg.readPC();
    fx.log(ID, `after 00 00: ${hex(silent2)} / probe ${hex(probe2)}; after bad CRC: ${hex(silent3)} / probe ${hex(probe3)}; ` +
      `after 07 F8: ${hex(silent4)} / probe ${hex(probe4)}; READ0 crcOk=${r.crcOk}; PC=${fx.h(pc)}`);

    assert.equal(silent2.length, 0, `bytes received after bad complement: ${hex(silent2)}`);
    assert.equal(silent3.length, 0, `bytes received after bad-CRC WRITE: ${hex(silent3)}`);
    assert.equal(silent4.length, 0, `bytes received after unknown command: ${hex(silent4)}`);
    assert.ok(probe2.equals(RES_OK), `PROBE after bad complement returned ${hex(probe2)}`);
    assert.ok(probe3.equals(RES_OK), `PROBE after bad CRC returned ${hex(probe3)}`);
    assert.ok(probe4.equals(RES_OK), `PROBE after unknown command returned ${hex(probe4)}`);

    assert.ok(r.complete && r.crcOk, `READ 0 incomplete or bad CRC (${r.raw.length} B)`);
    assert.ok(r.data.equals(before0x1000), 'READ 0 data changed: the bad-CRC WRITE touched flash');
    assert.ok(r.data.equals(P0), 'READ 0 data != T5 pattern P0 (run the sequence from T5)');

    assert.ok(!fx.pcInDefaultHandler(pc), `PC ${fx.h(pc)} is in Default_Handler`);
    assert.ok((pc & ~1) < 0x1000, `PC ${fx.h(pc)} is not < 0x1000`);
  });
});
