'use strict';
/**
 * T9 - CMD_SETWRP off: WRP record in bank-1 sector 127, BOOTRST and reboot ACK
 * Validates concerns 3, 1. Resources: jtag, serial. Setup group G2.
 * Precondition: no app at 0x1000 (state left by T5).
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, CMD, value, hex } = require('../lib/protocol');

const ID = 'T9';

describe('T9 - CMD_SETWRP off: WRP record in bank-1 sector 127, BOOTRST and reboot ACK', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('writes a level-0 record, reboots with 00 FF, and keeps answering', async function () {
    // Step 1: bootloader running with no app. Flush.
    fx.assertNoAppMagic(ID);
    await fx.startBootloader(ser);

    // Step 2: halt, find the first free 16-byte WRP slot, read wrp_level; run again and flush within 200 ms.
    dbg.halt();
    const slot = fx.findFreeWrpSlot();
    const levelBefore = fx.readWrpLevel();
    fx.log(ID, `wrp_level before=${levelBefore}; next record slot ${fx.h(slot.addr)}${slot.full ? ' (page full -> erase)' : ''}`);
    await fx.startBootloader(ser, { restart: false });

    // Step 3: SETWRP off (05 FA, 33 CC).
    await ser.write(Buffer.concat([value(CMD.SETWRP), value(cfg.boot.wrpLevelOff)]));
    // Step 4: wait up to 1.5 s for the reboot ACK (record write, then BOOTRST).
    const ack = await ser.readExact(2, cfg.timing.rebootAck);
    const ackExtra = await ser.collect(50);

    // Step 5: reconnect/refresh the debug session if the BOOTRST dropped it; halt; read wrp_level and the slot.
    const conn = dbg.refreshConnection();
    const levelAfter = fx.readWrpLevel();
    const record = fx.readWrpSlot(slot.addr);
    fx.log(ID, `ack=${hex(ack)} extra=${hex(ackExtra)} debug=${conn} wrp_level after=${levelAfter} slot=${fx.fmtWords(record)}`);

    // Step 6: run, PROBE within 200 ms.
    await fx.startBootloader(ser, { restart: false });
    const probe = await boot.probe();

    assert.ok(ack.equals(RES_OK) && ackExtra.length === 0,
      `reboot ACK: received ${hex(Buffer.concat([ack, ackExtra]))}, expected exactly 00 ff` +
      (ack.equals(Buffer.from([0x01, 0xfe])) ? ' (01 fe: WRP record write failed - concern 1)' : ''));
    assert.equal(levelAfter, 0, 'wrp_level after the reboot');
    assert.deepEqual(record.map((w) => fx.h(w)),
      [cfg.boot.wrpRecordMagic, 0x00000000, 0xffffffff, 0xffffffff].map((w) => fx.h(w)),
      `WRP record slot at ${fx.h(slot.addr)}`);
    assert.ok(probe.equals(RES_OK), `final PROBE returned ${hex(probe)}, expected 00 ff`);
  });
});
