'use strict';
/**
 * T6 - CMD_WRITE / CMD_READ in bank 1 (flashprep CMDWEPROTB model)
 * Validates concerns 1, 9. Resources: jtag, serial. Setup group G2.
 * Precondition: no app at 0x1000 (state left by T5).
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, RES_ERROR, hex } = require('../lib/protocol');
const { P2 } = require('../lib/patterns');

const ID = 'T6';

describe('T6 - CMD_WRITE / CMD_READ in bank 1 (flashprep CMDWEPROTB model)', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('writes and reads back P2 at 0x40800 (bank 1, sector 1)', async function () {
    // Step 1: bootloader running with no app present.
    fx.assertNoAppMagic(ID);
    await fx.startBootloader(ser);

    // Step 2: WRITE num=254 (0x40800, page aligned -> erase), 1024 B P2.
    const w = await boot.write(254, P2);
    // Step 3: READ num=254 cnt=255.
    const r = await boot.read(254, 255);
    fx.log(ID, `WRITE254=${hex(w)} READ254 hdr=${hex(r.header)} crcOk=${r.crcOk}`);

    // Step 4: halt and read 0x40800-0x40BFF.
    dbg.halt();
    const mem = dbg.readBytes(cfg.addr.bank1Block254, 0x400);

    if (w.equals(RES_ERROR)) {
      assert.fail('WRITE num=254 returned 01 fe: bank-1 CMDWEPROTA/B mapping in flashprep() (src/util.c) is wrong');
    }
    assert.ok(w.equals(RES_OK), `WRITE num=254 returned ${hex(w)}, expected 00 ff`);
    assert.ok(r.complete, `READ incomplete: ${r.raw.length} of 1030 bytes`);
    assert.equal(hex(r.header), 'ff 00', 'READ header');
    assert.ok(r.data.equals(P2), 'READ data != P2');
    assert.ok(r.crcOk, `READ CRC ${fx.h(r.crcRx ?? 0)} != ${fx.h(r.crcCalc)}`);
    assert.ok(mem.equals(P2), 'debugger memory at 0x40800 != P2');
  });
});
