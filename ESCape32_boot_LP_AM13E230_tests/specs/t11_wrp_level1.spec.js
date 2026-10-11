'use strict';
/**
 * T11 - WRP level 1: refused CMD_UPDATE, WEPROT applied on hand-off, and BOOTRST
 *       normalisation on reboot
 * Validates concerns 3, 2, 1. Resources: jtag, serial. Setup group G2.
 * Precondition: level 0, no app (state after the T10 teardown).
 * SAFETY: CMD_UPDATE is only sent after wrp_level reads back as 1 (at level 0 it would
 * rewrite the bootloader). WRP level 0x55 is never used.
 * Teardown: SETWRP off within 200 ms of a CPU reset, then remove the app magic.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, RES_ERROR, CMD, value, block, hex } = require('../lib/protocol');
const { P0, APP_BLOCK0, APP_BLOCK2, UPDATE_BLOCK } = require('../lib/patterns');

const ID = 'T11';

describe('T11 - WRP level 1: refused CMD_UPDATE, WEPROT applied on hand-off, BOOTRST normalisation', function () {
  let ser;
  let boot;
  let stateTouched = false;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('refuses UPDATE at level 1, protects sectors 0-1 on hand-off and clears WEPROT after reset', async function () {
    // Step 1: bootloader at level 0, no app. Flush.
    fx.assertNoAppMagic(ID);
    const slot = fx.findFreeWrpSlot();
    await fx.startBootloader(ser);

    // Step 2: SETWRP bootloader (05 FA, 44 BB); wait up to 1.5 s for the reboot ACK.
    stateTouched = true;
    await ser.write(Buffer.concat([value(CMD.SETWRP), value(cfg.boot.wrpLevelBoot)]));
    const ack2 = await ser.readExact(2, cfg.timing.rebootAck);

    // Step 3: reconnect if needed; halt; read wrp_level and the new record slot. Abort unless level 1.
    const conn = dbg.refreshConnection();
    const level = fx.readWrpLevel();
    const record = fx.readWrpSlot(slot.addr);
    fx.log(ID, `step2 ack=${hex(ack2)}; step3 debug=${conn} wrp_level=${level} slot ${fx.h(slot.addr)}=${fx.fmtWords(record)}`);
    assert.ok(ack2.equals(RES_OK), `step 2: reboot ACK ${hex(ack2)}, expected 00 ff`);
    assert.equal(level, 1, 'step 3: wrp_level must be 1 before CMD_UPDATE is sent - case aborted');
    assert.deepEqual(record.map((w) => fx.h(w)),
      [cfg.boot.wrpRecordMagic, 1, 0xfffffffe, 0xffffffff].map((w) => fx.h(w)), 'step 3: WRP record slot');

    // Step 4: run; within 200 ms UPDATE + one data block (DE AD BE EF); collect 500 ms.
    await fx.startBootloader(ser, { restart: false });
    await ser.write(Buffer.concat([value(CMD.UPDATE), block(UPDATE_BLOCK)]));
    const upd = await ser.collect(500);

    // Step 5: halt, read flash 0x0-0x7.
    dbg.halt();
    const vec = dbg.readWords(cfg.addr.flashVectors, 2);
    fx.log(ID, `step4 UPDATE response=${hex(upd)}; step5 vectors=${fx.fmtWords(vec)}`);

    // Step 6: run, install the T10 test app within 200 ms, then stay idle 1 s (timeout hand-off).
    await fx.startBootloader(ser, { restart: false });
    const w0 = await boot.write(0, APP_BLOCK0);
    const w2 = await boot.write(2, APP_BLOCK2);
    await fx.sleep(1000);

    // Step 7: halt, read PC and GSC WEPROT.
    dbg.halt();
    const pc7 = dbg.readPC();
    const weprot7 = fx.readWeprot();
    fx.log(ID, `step6 W0=${hex(w0)} W2=${hex(w2)}; step7 PC=${fx.h(pc7)} ${fx.fmtWeprot(weprot7)}`);

    // Step 8: CPU-level reset and run; collect serial 1 s; halt; read WEPROTA0.
    dbg.cpuReset();
    dbg.run();
    const serial8 = await ser.collect(1000);
    dbg.halt();
    const pc8 = dbg.readPC();
    const weprotA0_8 = dbg.readU32(cfg.reg.GSC_FPC_WEPROTA0);
    fx.log(ID, `step8 serial=${hex(serial8)} (reboot ACK ${serial8.includes(RES_OK) ? 'seen' : 'not seen'}, informational) ` +
      `PC=${fx.h(pc8)} WEPROTA0=${fx.h(weprotA0_8)}`);

    assert.ok(upd.equals(Buffer.concat([RES_OK, RES_ERROR])),
      `step 4: UPDATE response ${hex(upd)}, expected exactly 00 ff 01 fe (block accepted, update refused)`);
    assert.deepEqual(vec.map((w) => fx.h(w)), [cfg.addr.expectedVector0, cfg.addr.expectedVector1].map((w) => fx.h(w)),
      'step 5: bootloader vectors at 0x0/0x4 (bootloader intact)');
    assert.ok(w0.equals(RES_OK), `step 6: WRITE num=0 returned ${hex(w0)}`);
    assert.ok(w2.equals(RES_OK), `step 6: WRITE num=2 returned ${hex(w2)}`);
    assert.ok(fx.pcInTestApp(pc7), `step 7: PC ${fx.h(pc7)} not in [0x1808, 0x180B]`);
    assert.deepEqual(weprot7, { A0: 0x3, A1: 0, B0: 0, B1: 0 }, `step 7: GSC WEPROT ${fx.fmtWeprot(weprot7)}, expected A0=0x3, others 0`);
    assert.equal(weprotA0_8, 0,
      `step 8: FPC_WEPROTA0 = ${fx.h(weprotA0_8)} after the CPU reset, expected 0 (PC=${fx.h(pc8)}` +
      `${fx.pcInTestApp(pc8) ? ' - the bootloader had already handed off to the test app again' : ''})`);
  });

  after(async function () {
    if (!stateTouched || !dbg.isProgramLoaded()) return;
    // Teardown: CPU reset + run; within 200 ms SETWRP off and wait for 00 FF; within 200 ms of
    // that ACK rewrite P0 at num=0; halt and confirm level 0, no magic, no WEPROT. Retry if the app won.
    let lastState = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      await fx.resetAndRun(ser);
      await ser.write(Buffer.concat([value(CMD.SETWRP), value(cfg.boot.wrpLevelOff)]));
      // Up to two 00 FF may arrive: an optional boot ACK after the reset, then the SETWRP reboot ACK.
      let acks = await ser.readExact(2, cfg.timing.rebootAck);
      acks = Buffer.concat([acks, await ser.collect(60)]);
      const w = await boot.writeTolerant(0, P0);
      const conn = dbg.refreshConnection();
      const level = fx.readWrpLevel();
      const hw = dbg.readU16(cfg.addr.appBase);
      const weprot = fx.readWeprot();
      lastState = `attempt ${attempt}: acks=${hex(acks)} WRITE=${hex(w)} debug=${conn} wrp_level=${level} ` +
        `halfword@0x1000=${fx.h(hw, 4)} ${fx.fmtWeprot(weprot)}`;
      fx.log(ID, `teardown ${lastState}`);
      const clean = level === 0 && hw !== cfg.boot.appMagic && weprot.A0 === 0 && weprot.A1 === 0 &&
        weprot.B0 === 0 && weprot.B1 === 0;
      if (clean) return;
    }
    throw new Error(`T11 teardown did not restore level 0 / no app / no WEPROT (${lastState}). ` +
      'Leaving WEPROT set blocks reflashing the bootloader until a BOOTRST or power cycle.');
  });
});
