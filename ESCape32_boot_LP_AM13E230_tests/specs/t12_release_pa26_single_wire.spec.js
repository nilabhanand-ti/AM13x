'use strict';
/**
 * T12 - Release_PA26 single-wire UART on PA26 (IO_PA2)            [STUB]
 * Validates concerns 10, 5, 6. Resources: jtag, serial. Setup group G3.
 *
 * Channel / pin: an external 3.3 V USB-UART, TX and RX tied together through a ~1 kOhm
 * series resistor on TX, connected to PA26 = BoosterPack J1.2, GND to J2.20. Confirm on
 * the schematic that nothing on the PA26/PGA_GND net loads the pin.
 *
 * TODO(stub): needs an external single-wire (half-duplex) 3.3 V USB-UART on PA26 (J1.2),
 * which is not in the resource inventory.
 * When that adapter is available:
 *   1. Build Release_PA26 (make it the active configuration; the build helper builds the
 *      active configuration) and flash Release_PA26/ESCape32_boot_LP_AM13E230.out.
 *   2. Restart to the entry point.
 *   3. Open the adapter's COM port at 38400 8N1; discard the host's own echo (a single
 *      wire echoes TX).
 *   4. PROBE -> 00 FF; INFO byte 1 = 0x0B (IO_PIN 11) with a valid CRC; WRITE/READ num=0
 *      round-trips; the T8 malformed-frame set; the next PROBE still works (PF 9 -> PF 8
 *      swap back and RXE restore after sendbuf()).
 *   Teardown: reflash the Debug build.
 */
describe('T12 - Release_PA26 single-wire UART on PA26 (IO_PA2)', function () {
  it.skip('PROBE/INFO/WRITE/READ over a single wire on PA26 (J1.2) - needs an external half-duplex 3.3 V USB-UART', function () {});
});
