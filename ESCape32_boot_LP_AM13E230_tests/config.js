'use strict';
/**
 * Single source of configuration for the ESCape32 bootloader hardware test suite.
 *
 * Every value here comes from migration-test-plan.md (Test Strategy / Fixed Wiring
 * Setup / Debug-helper rules), the Debug .map, or the AM13E2X SDK device headers
 * (source/device/am13e230x/include/hw/hw_*.h). Environment variables override the
 * machine-specific paths and the COM port.
 */
const path = require('path');

const TESTS_DIR = __dirname;
const PROJECT_NAME = 'ESCape32_boot_LP_AM13E230';
// The test project lives NEXT TO the CCS project (sibling folder
// <workspace>/ESCape32_boot_LP_AM13E230_tests), not inside it: a tests/ folder inside the
// CCS project makes the CDT managed build compile node_modules/**/*.cpp and break the link.
const PROJECT_DIR = process.env.BOOT_PROJECT_DIR || path.resolve(TESTS_DIR, '..', PROJECT_NAME);
const env = process.env;

module.exports = {
  // ---------------------------------------------------------------- paths
  ccsInstall: env.CCS_INSTALL_DIR || 'C:/ti/ccs2101',
  /** CCS workspace that contains the project (passed to ccs-server-cli -workspace). */
  workspace: env.CCS_WORKSPACE || path.resolve(PROJECT_DIR, '..'),
  projectName: PROJECT_NAME,
  projectDir: PROJECT_DIR,
  testsDir: TESTS_DIR,
  resultsDir: path.join(TESTS_DIR, 'results'),
  /** The plan tests the Debug configuration (IO_UC4 two-wire UART on the XDS110 backchannel). */
  buildConfig: 'Debug',
  outFile: path.join(PROJECT_DIR, 'Debug', `${PROJECT_NAME}.out`),
  ccxml: path.join(PROJECT_DIR, 'targetConfigs', 'AM13E23019.ccxml'),
  /** Core of the AM13E23019 (Cortex-M33) to open the scripting session against. */
  corePattern: env.DEBUG_CORE_PATTERN ? new RegExp(env.DEBUG_CORE_PATTERN, 'i') : /cortex/i,
  /** Reset type for the "CPU-level reset". NEVER "System Reset" (it disconnects the target). */
  cpuResetType: 'CPU Subsystem Reset',
  forbiddenResetType: 'System Reset',

  // ---------------------------------------------------------------- serial
  serial: {
    path: env.BOOT_COM_PORT || 'COM6', // XDS110 Application/User UART
    baudRate: 38400,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
  },

  // ---------------------------------------------------------------- timing (ms)
  timing: {
    scriptingTimeout: 60000, // default scripting-API call timeout
    loadTimeout: 180000, // program load (flash) timeout
    postRunSettle: 30, // after run(): wait, then flush RX (well inside the 200 ms budget)
    probeResponse: 100,
    infoResponse: 300,
    readResponse: 1500,
    writeResponse: 2000,
    rebootAck: 1500,
    bootAckDiscardWindow: 40,
  },

  // ---------------------------------------------------------------- bootloader constants
  boot: {
    revision: 4,
    ioPinUc4: 15,
    appMagic: 0x32ea,
    wrpRecordMagic: 0x32ea5752,
    wrpLevelOff: 0x33,
    wrpLevelBoot: 0x44,
  },

  // ---------------------------------------------------------------- addresses (Debug .map / plan)
  addr: {
    main: 0x40,
    mainEnd: 0x2ab,
    resetHandler: 0x328, // was 0x2ac before the T3 UC4 baud-divisor fix (initio() now out of line)
    defaultHandler: 0x5fa,
    defaultHandlerEnd: 0x5fb,
    recvbuf: 0x518,
    recvbufEnd: 0x567,
    recvval: 0x6e2,
    recvvalEnd: 0x709,
    ramfuncLoad: 0x800, // .TI.ramfunc load address (0x7cc -> 0x7d0 after the T1 palign(16) fix, 0x800 after the T3 fix)
    ramfuncRun: 0x00c18000,
    wrpLevel: 0x20000000,
    flashVectors: 0x0,
    appBase: 0x1000,
    appVectors: 0x1800,
    deviceId: 0x60111004,
    wrpPage: 0x7f800,
    wrpPageSize: 0x800,
    bank1Block254: 0x40800,
    expectedVector0: 0x20001000,
    expectedVector1: 0x00000329,
  },
  /** Symbols whose address is cross-checked against `addr` after the program is loaded. */
  symbolChecks: {
    main: 0x40,
    Reset_Handler: 0x328,
    Default_Handler: 0x5fa,
    recvbuf: 0x518,
    recvval: 0x6e2,
    wrp_level: 0x20000000,
    __ramfunct_load__: 0x800,
  },

  // ---------------------------------------------------------------- registers (AM13E2X SDK hw_*.h)
  reg: {
    SYSTICK_CTRL: 0xe000e010,
    SYSTICK_LOAD: 0xe000e014,
    // UC4_UART_BASE 0x40641000 (hw_memmap.h), offsets from hw_unicommuart.h
    UC4_UART_CTL0: 0x40641000 + 0x100,
    UC4_UART_IBRD: 0x40641000 + 0x110,
    UC4_UART_FBRD: 0x40641000 + 0x114,
    // SYSCTL_BASE 0x400AF000, offsets from hw_sysctl.h. RSTCAUSE (0x1220) is read-to-clear: NEVER read it.
    SYSCTL_MCLKCFG: 0x400af000 + 0x1104,
    SYSCTL_SYSTEMCFG: 0x400af000 + 0x1180,
    SYSCTL_CLKSTATUS: 0x400af000 + 0x1204,
    // FRI_BASE 0x40028000, offsets from hw_fri.h
    FRI_FRDCNTL: 0x40028000 + 0x1000,
    FRI_FRD_INTF_CTRL: 0x40028000 + 0x100c,
    // CRC_BASE 0x401B2000, offsets from hw_crcp.h
    CRCP_CRCCTRL: 0x401b2000 + 0x1100,
    CRCP_CRCPOLY: 0x401b2000 + 0x1110,
    // GSC_BASE 0x40046000, offsets from hw_gsc.h
    GSC_FPC_WEPROTA0: 0x40046000 + 0x1600,
    GSC_FPC_WEPROTA1: 0x40046000 + 0x1604,
    GSC_FPC_WEPROTB0: 0x40046000 + 0x1608,
    GSC_FPC_WEPROTB1: 0x40046000 + 0x160c,
  },
  bits: {
    SYSTICK_CTRL_ENABLE_CLKSOURCE: 0x5,
    SYSTICK_CTRL_CLKSOURCE: 0x4, // read-as-one on the AM13E23019 (SYST_CALIB.NOREF = 1)
    UART_CTL0_ENABLE: 0x00000001,
    UART_CTL0_RXE: 0x00000008,
    UART_CTL0_TXE: 0x00000010,
    UART_CTL0_MAJVOTE: 0x00040000,
    SYSCTL_MCLKCFG_USEHSCLK: 0x00010000,
    SYSCTL_MCLKCFG_MCLKDIVCFG_MASK: 0x07000000,
    SYSCTL_MCLKCFG_MCLKDIVCFG_DIV_2_DIV_4: 0x07000000, // DL_SYSCTL_MCLK_DIV_2_DIV_4
    SYSCTL_CLKSTATUS_HSCLKMUX: 0x00000010,
    SYSCTL_SYSTEMCFG_FLASHECCRSTDIS: 0x00000004,
    FRI_FRDCNTL_WS0_MODE: 0x00000001, // set => 0 wait states (RWAIT ignored), see DL_FRI_getReadWaitStates()
    FRI_FRDCNTL_RWAIT_MASK: 0x00000f00,
    FRI_FRD_INTF_CTRL_DLB_EN: 0x00000002,
    FRI_FRD_INTF_CTRL_CACHE_EN: 0x00000004,
    CRCP_CRCCTRL_CHECK_MASK: 0x00000017, // POLYSIZE | BITREVERSE | INPUT_ENDIANNESS | OUTPUT_BYTESWAP
    CRCP_CRCCTRL_EXPECTED: 0x00000002, // CRC32 | BITREVERSE_REVERSED | LITTLE_ENDIAN | byteswap off
    CRC32_POLY: 0x04c11db7,
  },
};
