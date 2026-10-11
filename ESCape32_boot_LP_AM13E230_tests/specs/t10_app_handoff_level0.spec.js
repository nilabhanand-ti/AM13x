'use strict';
/**
 * T10 - App hand-off at WRP level 0 (magic check, MSP/vector jump, peripheral resets)
 * Validates concerns 2, 1, 3. Resources: jtag, serial. Setup group G2.
 * Precondition: level 0, no app (state after T9).
 * Teardown: CPU-level reset, PROBE within 200 ms, rewrite P0 at block 0 to remove the magic.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { RES_OK, hex } = require('../lib/protocol');
const { P0, APP_BLOCK0, APP_BLOCK2 } = require('../lib/patterns');

const ID = 'T10';

describe('T10 - App hand-off at WRP level 0 (magic check, MSP/vector jump, peripheral resets)', function () {
  let ser;
  let boot;
  let appInstalled = false;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('jumps to the test app with MSP set, SysTick stopped, UC4 reset and no WEPROT', async function () {
    // Step 1: bootloader running at level 0. Flush.
    fx.assertNoAppMagic(ID);
    await fx.startBootloader(ser);

    // Step 2: install the minimal test app (block 0 = magic, block 2 = vectors + `b .`).
    appInstalled = true;
    const w0 = await boot.write(0, APP_BLOCK0);
    const w2 = await boot.write(2, APP_BLOCK2);
    // Step 3: read back both blocks, then without pausing send 07 F8 (unknown -> done:).
    const r0 = await boot.read(0, 3);
    const r2 = await boot.read(2, 3);
    await ser.write([0x07, 0xf8]);

    // Step 4: wait 300 ms (no serial bytes expected), halt, read the state.
    const afterJump = await ser.collect(300);
    dbg.halt();
    const pc = dbg.readPC();
    const msp = dbg.readMSP();
    const systickCtrl = dbg.readU32(cfg.reg.SYSTICK_CTRL);
    const uartCtl0 = dbg.readU32(cfg.reg.UC4_UART_CTL0);
    const weprot = fx.readWeprot();
    fx.log(ID, `W0=${hex(w0)} W2=${hex(w2)} afterJump=${hex(afterJump)} PC=${fx.h(pc)} ${msp.name}=${fx.h(msp.value)} ` +
      `SysTick.CTRL=${fx.h(systickCtrl)} UC4.CTL0=${fx.h(uartCtl0)} ${fx.fmtWeprot(weprot)}`);

    assert.ok(w0.equals(RES_OK), `WRITE num=0 returned ${hex(w0)}`);
    assert.ok(w2.equals(RES_OK), `WRITE num=2 returned ${hex(w2)}`);
    assert.ok(r0.complete && r0.crcOk && r0.data.equals(APP_BLOCK0), `READ 0 mismatch: ${hex(r0.raw)}`);
    assert.ok(r2.complete && r2.crcOk && r2.data.equals(APP_BLOCK2), `READ 2 mismatch: ${hex(r2.raw)}`);
    assert.equal(afterJump.length, 0, `serial bytes after the jump: ${hex(afterJump)}`);
    assert.ok(fx.pcInTestApp(pc), `PC ${fx.h(pc)} not in [0x1808, 0x180B]`);
    assert.equal(fx.h(msp.value), fx.h(0x20001000), 'MSP');
    // SysTick stopped = ENABLE and TICKINT clear. CLKSOURCE (bit 2) is read-as-one on this core: SYST_CALIB.NOREF = 1
    // (0xC0186A00, no reference clock), CSR resets to 0x4 and a write of 0 reads back 0x4 (verified on hardware during T10).
    assert.equal(systickCtrl & ~cfg.bits.SYSTICK_CTRL_CLKSOURCE, 0,
      `SysTick CTRL = ${fx.h(systickCtrl)}, expected 0 apart from the read-as-one CLKSOURCE bit (0x4)`);
    assert.equal(uartCtl0 & cfg.bits.UART_CTL0_ENABLE, 0, `UC4 UART CTL0.ENABLE = 1 (${fx.h(uartCtl0)}), module not reset`);
    assert.deepEqual(weprot, { A0: 0, A1: 0, B0: 0, B1: 0 }, `GSC WEPROT not all 0: ${fx.fmtWeprot(weprot)}`);
  });

  after(async function () {
    if (!appInstalled || !dbg.isProgramLoaded()) return;
    // Teardown: CPU-level reset + run; within 200 ms PROBE (discard boot ACK); WRITE P0 at num=0; confirm.
    let lastState = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      await fx.resetAndRun(ser);
      const { response: probe } = await boot.probeTolerant();
      const w = await boot.writeTolerant(0, P0);
      dbg.halt();
      const hw = dbg.readU16(cfg.addr.appBase);
      lastState = `attempt ${attempt}: PROBE=${hex(probe)} WRITE=${hex(w)} halfword@0x1000=${fx.h(hw, 4)}`;
      fx.log(ID, `teardown ${lastState}`);
      if (hw !== cfg.boot.appMagic && w.equals(RES_OK)) return;
    }
    throw new Error(`T10 teardown could not remove the app magic at 0x1000 (${lastState})`);
  });
});
