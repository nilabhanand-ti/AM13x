'use strict';
/**
 * T2 - Generated clock, UART, SysTick, CRCP and flash-DED register state
 * Validates concerns 4, 5, 6, 7. Resources: jtag. Setup group G1.
 * Register addresses: AM13E2X SDK hw_memmap.h / hw_unicommuart.h / hw_sysctl.h / hw_fri.h / hw_crcp.h.
 * SYSCTL RSTCAUSE is never read (read-to-clear).
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');

const ID = 'T2';

describe('T2 - Generated clock, UART, SysTick, CRCP and flash-DED register state', function () {
  before(async function () {
    await fx.prepareTarget();
  });

  it('has the generated SysTick / UC4 / SYSCTL / FRI / CRCP configuration', async function () {
    const R = cfg.reg;
    const B = cfg.bits;

    // Step 1: if an app magic is present, run to recvval so the bootloader is still in its own code;
    // otherwise restart to the entry point, run 1 s, halt.
    dbg.halt();
    const appPresent = dbg.readU16(cfg.addr.appBase) === cfg.boot.appMagic;
    dbg.restartToEntry();
    if (appPresent) {
      fx.log(ID, 'app magic present at 0x1000 - running to breakpoint at recvval (0x6B6)');
      dbg.runToBreakpoint(cfg.addr.recvval);
    } else {
      dbg.run();
      await fx.sleep(1000);
      dbg.halt();
    }

    // Step 2: read the registers.
    const v = {
      systickLoad: dbg.readU32(R.SYSTICK_LOAD),
      systickCtrl: dbg.readU32(R.SYSTICK_CTRL),
      uartIbrd: dbg.readU32(R.UC4_UART_IBRD),
      uartFbrd: dbg.readU32(R.UC4_UART_FBRD),
      uartCtl0: dbg.readU32(R.UC4_UART_CTL0),
      mclkcfg: dbg.readU32(R.SYSCTL_MCLKCFG),
      clkstatus: dbg.readU32(R.SYSCTL_CLKSTATUS),
      systemcfg: dbg.readU32(R.SYSCTL_SYSTEMCFG),
      frdcntl: dbg.readU32(R.FRI_FRDCNTL),
      frdIntfCtrl: dbg.readU32(R.FRI_FRD_INTF_CTRL),
      crcPoly: dbg.readU32(R.CRCP_CRCPOLY),
      crcCtrl: dbg.readU32(R.CRCP_CRCCTRL),
    };
    fx.log(ID, Object.entries(v).map(([k, x]) => `${k}=${fx.h(x)}`).join(' '));

    const failures = [];
    const check = (ok, msg) => { if (!ok) failures.push(msg); };

    // SysTick
    check(v.systickLoad === 0x00f423ff, `SysTick LOAD = ${fx.h(v.systickLoad)}, expected 0x00F423FF`);
    check((v.systickCtrl & 0x7) === B.SYSTICK_CTRL_ENABLE_CLKSOURCE,
      `SysTick CTRL & 0x7 = ${fx.h(v.systickCtrl & 0x7, 1)}, expected 0x5 (ENABLE|CLKSOURCE, no TICKINT)`);
    // UC4 UART
    check(v.uartIbrd === 26, `UC4 IBRD = ${v.uartIbrd}, expected 26`);
    check(v.uartFbrd === 3, `UC4 FBRD = ${v.uartFbrd}, expected 3`);
    const ctl0Need = B.UART_CTL0_ENABLE | B.UART_CTL0_TXE | B.UART_CTL0_RXE | B.UART_CTL0_MAJVOTE;
    check((v.uartCtl0 & ctl0Need) === ctl0Need,
      `UC4 CTL0 = ${fx.h(v.uartCtl0)}, expected ENABLE|TXE|RXE|MAJVOTE (${fx.h(ctl0Need)}) set`);
    // SYSCTL
    check((v.mclkcfg & B.SYSCTL_MCLKCFG_USEHSCLK) === 0, `MCLKCFG.USEHSCLK = 1 (MCLKCFG ${fx.h(v.mclkcfg)})`);
    check((v.clkstatus & B.SYSCTL_CLKSTATUS_HSCLKMUX) === 0, `CLKSTATUS.HSCLKMUX = 1, MCLK not on SYSOSC (${fx.h(v.clkstatus)})`);
    check((v.mclkcfg & B.SYSCTL_MCLKCFG_MCLKDIVCFG_MASK) === B.SYSCTL_MCLKCFG_MCLKDIVCFG_DIV_2_DIV_4,
      `MCLKCFG.MCLKDIVCFG = ${fx.h(v.mclkcfg & B.SYSCTL_MCLKCFG_MCLKDIVCFG_MASK)}, expected DIV_2_DIV_4 (0x07000000)`);
    check((v.systemcfg & B.SYSCTL_SYSTEMCFG_FLASHECCRSTDIS) === 0,
      `SYSTEMCFG.FLASHECCRSTDIS = 1 (DED -> NMI instead of reset) (${fx.h(v.systemcfg)})`);
    // FRI
    // Effective read wait states follow DL_FRI_getReadWaitStates(): WS0_MODE=1 means 0 wait states
    // (DL_FRI_setReadWaitStates(0) -> DL_FRI_setZeroReadWaitStates() sets WS0_MODE and leaves RWAIT as is).
    const ws0Mode = (v.frdcntl & B.FRI_FRDCNTL_WS0_MODE) !== 0;
    const readWaitStates = ws0Mode ? 0 : (v.frdcntl & B.FRI_FRDCNTL_RWAIT_MASK) >>> 8;
    check(readWaitStates === 0,
      `FRI read wait states = ${readWaitStates} (FRDCNTL ${fx.h(v.frdcntl)}, WS0_MODE=${ws0Mode ? 1 : 0}), expected 0`);
    check((v.frdIntfCtrl & B.FRI_FRD_INTF_CTRL_DLB_EN) !== 0, `FRI FRD_INTF_CTRL.DLB_EN = 0 (${fx.h(v.frdIntfCtrl)})`);
    // CACHE_EN is held at 0 by the FRI while WS0_MODE=1 (verified on hardware: a debugger write of 0x6 to
    // FRD_INTF_CTRL reads back 0x2 with WS0_MODE=1, and 0x6 with WS0_MODE=0). The generated
    // SYSCFG_DL_FLASH_init() still calls DL_FRI_enableCache(), so CACHE_EN is only required when WS0_MODE=0.
    if (!ws0Mode) {
      check((v.frdIntfCtrl & B.FRI_FRD_INTF_CTRL_CACHE_EN) !== 0, `FRI FRD_INTF_CTRL.CACHE_EN = 0 (${fx.h(v.frdIntfCtrl)})`);
    } else {
      fx.log(ID, `FRI WS0_MODE=1 (zero-wait-state mode): CACHE_EN=${(v.frdIntfCtrl & B.FRI_FRD_INTF_CTRL_CACHE_EN) ? 1 : 0} ` +
        '(hardware holds it at 0 in this mode; not checked)');
    }
    // CRCP
    check(v.crcPoly === B.CRC32_POLY, `CRCP POLY = ${fx.h(v.crcPoly)}, expected 0x04C11DB7`);
    check((v.crcCtrl & B.CRCP_CRCCTRL_CHECK_MASK) === B.CRCP_CRCCTRL_EXPECTED,
      `CRCP CRCCTRL = ${fx.h(v.crcCtrl)}, expected CRC32|BITREVERSE_REVERSED|LITTLE_ENDIAN, byteswap off (0x2)`);

    assert.deepEqual(failures, [], `Register mismatches:\n  - ${failures.join('\n  - ')}`);
  });
});
