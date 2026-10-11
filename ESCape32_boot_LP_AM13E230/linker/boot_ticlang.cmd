/*
 * ESCape32 bootloader for AM13E23019 - TI Arm Clang linker command file.
 * Used by the CCS project and by the standalone CMake front-end (ticlang presets).
 * All link options live here; no SDK linker file, .cinit/.binit, stack or heap
 * sections, BCR/BSL/NONMAIN sections or interruptVectors are used.
 *
 * Layout (unchanged from ESCape32):
 *   FLASH_BOOT 0x00000000-0x00000FFF  bootloader image (4 KB budget)
 *   0x00001000                        cfg sector (magic 0x32ea), _rom_end
 *   0x00001800                        application vector table
 *   RAM_BOOT   0x20000000-0x20000FFF  .data/.bss + stack (__StackTop = _ram_end)
 *   0x20001000-0x20001FFF             UPDATE buffer (above _ram_end)
 *   RAM_C      0x00C18000-0x00C1FFFF  .TI.ramfunc run address
 */

--entry_point=Reset_Handler
--rom_model
--zero_init=off
--cinit_compression=off
--diag_suppress=10063
--retain="*(.vectors)"

MEMORY
{
    FLASH_BOOT  : ORIGIN = 0x00000000, LENGTH = 0x00001000
    RAM_BOOT    : ORIGIN = 0x20000000, LENGTH = 0x00001000
    RAM_C       : ORIGIN = 0x00C18000, LENGTH = 0x00008000
}

_rom       = 0x00000000;
_rom_end   = 0x00001000;
_ram_end   = 0x20001000;
__StackTop = 0x20001000;

/*
 * Every flash-loaded section starts and ends on a 16-byte (128-bit flash word + ECC)
 * boundary (palign(16); the SDK linker file uses palign(8)). Otherwise two ELF load
 * segments share one flash word and the CCS flash loader fails with
 * "File Loader: Memory write failed" when it programs that word a second time.
 */
SECTIONS
{
    .vectors     : > 0x00000000
    .text        : > FLASH_BOOT, palign(16)
    .rodata      : > FLASH_BOOT, palign(16)
    .TI.ramfunc  : load = FLASH_BOOT, run = RAM_C, palign(16),
                   LOAD_START(__ramfunct_load__),
                   RUN_START(__ramfunct_start__),
                   RUN_END(__ramfunct_end__)
    .data        : load = FLASH_BOOT, run = RAM_BOOT, palign(16),
                   LOAD_START(__data_load__),
                   RUN_START(__data_start__),
                   RUN_END(__data_end__)
    .bss         : > RAM_BOOT, palign(4),
                   RUN_START(__bss_start__),
                   RUN_END(__bss_end__)
}
