'use strict';
/**
 * T5 - CMD_WRITE / CMD_READ in bank 0, page erase and tail padding (also clears any stale app)
 * Validates concerns 1, 5, 6, 9. Resources: jtag, serial. Setup group G2.
 * Teardown: none - the non-magic P0 pattern stays at 0x1000 so T6-T9 run with no app present.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, hex } = require('../lib/protocol');
const { P0, P1 } = require('../lib/patterns');

const ID = 'T5';

describe('T5 - CMD_WRITE / CMD_READ in bank 0, page erase and tail padding', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('writes, reads back and programs P0 at 0x1000 and P1 (0xFF padded) at 0x1400', async function () {
    // Step 1: restart and run, flush; the first command goes out within 200 ms (a stale app may be present).
    await fx.startBootloader(ser);

    // Step 2: WRITE num=0, 1024 B P0 (erases page 0x1000, cnt=255).
    const w0 = await boot.write(0, P0);
    // Step 3: WRITE num=1, 36 B P1 (no erase, 0xFF tail padding of the 128-bit word).
    const w1 = await boot.write(1, P1);
    // Step 4: READ num=0 cnt=255 and READ num=1 cnt=8.
    const r0 = await boot.read(0, 255);
    const r1 = await boot.read(1, 8);
    fx.log(ID, `WRITE0=${hex(w0)} WRITE1=${hex(w1)} READ0 hdr=${hex(r0.header)} crcOk=${r0.crcOk} ` +
      `READ1 hdr=${hex(r1.header)} crcOk=${r1.crcOk}`);

    // Step 5: halt and read 0x1000-0x13FF and 0x1400-0x142F through the debugger.
    dbg.halt();
    const mem0 = dbg.readBytes(0x1000, 0x400);
    const mem1 = dbg.readBytes(0x1400, 0x30);
    const appHalfword = dbg.readU16(cfg.addr.appBase);

    assert.ok(w0.equals(RES_OK), `WRITE num=0 returned ${hex(w0)}, expected 00 ff`);
    assert.ok(w1.equals(RES_OK), `WRITE num=1 returned ${hex(w1)}, expected 00 ff`);

    assert.ok(r0.complete, `READ 0 incomplete: ${r0.raw.length} of 1030 bytes`);
    assert.equal(hex(r0.header), 'ff 00', 'READ 0 header');
    assert.ok(r0.data.equals(P0), 'READ 0 data != P0');
    assert.ok(r0.crcOk, `READ 0 CRC ${fx.h(r0.crcRx ?? 0)} != ${fx.h(r0.crcCalc)}`);

    assert.ok(r1.complete, `READ 1 incomplete: ${r1.raw.length} of 42 bytes`);
    assert.equal(hex(r1.header), '08 f7', 'READ 1 header');
    assert.ok(r1.data.equals(P1), `READ 1 data != P1: ${hex(r1.data)}`);
    assert.ok(r1.crcOk, `READ 1 CRC ${fx.h(r1.crcRx ?? 0)} != ${fx.h(r1.crcCalc)}`);

    assert.ok(mem0.equals(P0), 'debugger memory at 0x1000 != P0');
    assert.ok(mem1.subarray(0, 36).equals(P1), `debugger memory at 0x1400 != P1: ${hex(mem1.subarray(0, 36))}`);
    assert.equal(hex(mem1.subarray(36, 48)), hex(Buffer.alloc(12, 0xff)), '0x1424-0x142F tail padding');
    assert.notEqual(appHalfword, cfg.boot.appMagic, 'halfword at 0x1000 is the app magic 0x32EA');
  });
});
