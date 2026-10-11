'use strict';
/**
 * T13 - Release_TIMER TIMG4 soft-UART on PA27 (IO_TIMER)          [STUB]
 * Validates concerns 10, 7, 6. Resources: jtag, serial. Setup group G4.
 *
 * Channel / pin: the same external half-duplex 3.3 V USB-UART as T12, on
 * PA27 = BoosterPack J3.27, GND to J2.20.
 *
 * TODO(stub): needs an external single-wire (half-duplex) 3.3 V USB-UART on PA27 (J3.27),
 * which is not in the resource inventory.
 * When that adapter is available:
 *   1. Build Release_TIMER (make it the active configuration) and flash
 *      Release_TIMER/ESCape32_boot_LP_AM13E230.out; restart to the entry point.
 *   2. Halt after initio(); read TIMG4 CCCTL_01[1] (COC = COMPARE after the fix-up) and
 *      CCCTL_01[0] (COC = CAPTURE, ZCOND).
 *   3. At 38400 8N1: PROBE x50 -> 50/50 00 FF; INFO byte 1 = 0x0E (IO_PIN 14) with a valid
 *      CRC; a 1024-byte WRITE/READ round-trips without framing errors (LOAD 416 / half-bit 208).
 *   Teardown: reflash the Debug build.
 */
describe('T13 - Release_TIMER TIMG4 soft-UART on PA27 (IO_TIMER)', function () {
  it.skip('TIMG4 soft-UART on PA27 (J3.27): CCCTL check, 50 PROBEs, INFO, 1024 B round-trip - needs an external half-duplex 3.3 V USB-UART', function () {});
});
