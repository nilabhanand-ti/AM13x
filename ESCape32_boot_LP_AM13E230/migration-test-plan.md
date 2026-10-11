# **Migration Test Plan**

## **Test Strategy**

- Mode: `create-tests`
- Resources: `jtag, serial + "For the bootloader project, build and debug it"` — `JTAG + serial (XDS110 backchannel COM6), no instrument`
- Target config mechanism: `SysConfig`
- Project: `ESCape32_boot_LP_AM13E230`
- Language: `JavaScript`
- Framework: `Mocha`
- Test project dir: `C:/Users/anand/workspace_ccstheia/ESCape32_boot_LP_AM13E230_tests`
- Results file: `C:/Users/anand/workspace_ccstheia/ESCape32_boot_LP_AM13E230_tests/results/results.json`

**Scope.** All three ported areas (core, signal-io, flash-crc) are complete. The plan tests the **Debug** build configuration, which is the default `IO_UC4` two-wire UART on the XDS110 backchannel (UC4 TX PA0 / RX PA1, 38400 8N1). This is the only variant this setup can drive without extra wiring. The `IO_PA2` (Release_PA26, single wire on PA26) and `IO_TIMER` (Release_TIMER, TIMG4 soft-UART on PA27) variants each need a single-wire USB-UART on a BoosterPack header. They are planned as `stub` cases (T12, T13) so the gap is recorded.

**Host protocol (ESCape32 bootloader, binary, no text).** Every case that talks to the bootloader uses these framing rules. The generated serial helper must open COM6 in raw binary mode with no newline translation.

- **Value:** 2 bytes `[v, v ^ 0xFF]`. Responses: `RES_OK` = `00 FF`, `RES_ERROR` = `01 FE`.
- **Data block:** value `cnt = len/4 − 1`, then `len` bytes, then the CRC-32 as 4 bytes little-endian. The CRC is standard zlib/ISO-3309 CRC-32 of the data bytes (`binascii.crc32` / `zlib.crc32`). `len` must be a multiple of 4, and is 1024 at most.
- **Commands** (sent as a value):
  - `CMD_PROBE` = 0 → `00 FF`
  - `CMD_INFO` = 1 → data block of 32 bytes: `[REVISION=4, IO_PIN=15, DEVICEID byte0..3 (LE), 0 × 26]`
  - `CMD_READ` = 2, then value `num`, then value `cnt` → data block of `(cnt+1)*4` bytes from `0x1000 + num*1024`
  - `CMD_WRITE` = 3, then value `num`, then a data block → `00 FF` / `01 FE`. Writing to an address that is 2 KB-page aligned erases that page first. Writing to block `num` (at `0x1000 + num*1024`) erases only when that address is page aligned (even `num`).
  - `CMD_UPDATE` = 4, then data blocks → `00 FF` per block, then `01 FE` if refused. **Destructive at WRP level 0** because it rewrites the bootloader itself. It is only used in T11, guarded on level 1.
  - `CMD_SETWRP` = 5, then value `0x33` (off) / `0x44` (bootloader) / `0x55` (full) → on success, the bootloader writes a record and does a BOOTRST, then sends `00 FF` as the reboot ACK. On failure it sends `01 FE`. Level `0x55` is never used in this plan.
  - Any other value, a malformed value, or 500 ms of idle per byte → `done:`. If the halfword at `0x1000` equals `0x32EA`, the bootloader jumps to the app (vectors at `0x1800`). Otherwise it stays in the command loop and sends nothing.
- **Timing hazard.** While an app image with the magic is present at `0x1000`, the bootloader hands off after 500 ms of serial idle. In those cases, the spec must send its first command within ~200 ms of letting the core run.
- **Flush and boot ACK.** Flush COM6 RX before every command. A `00 FF` reboot ACK can appear after any reset whose cause is BOOTSW/SYSSW/CPUSW. Specs must tolerate (discard) one leading `00 FF` after a reset unless the case asserts it.

**Debug-helper rules for this target.** These come from the LP-AM13E230 board AGENTS.md known issues and from the firmware design:

- After loading, **restart** to the entry point (`Reset_Handler` 0x329; 0x2AD before the T3 UC4 baud-divisor fix) before running. Halt first if the core is running.
- Never use the "System Reset" reset type. It disconnects the target. Use the CPU-level reset only.
- If the target becomes unresponsive, terminate and re-launch the debug session. A USB-C replug is the fallback.
- **Never read `SYSCTL RSTCAUSE` through the debugger.** It is read-to-clear and the firmware depends on it.
- A BOOTRST (T9, T11) resets the core debug logic without the debugger noticing: FPB_CTRL.ENABLE drops to 0, so restart/run-to-main never halts, and multi-word memory reads return word 0 repeated. After every BOOTRST, force a disconnect/connect before verifying memory or restarting (verified on hardware during T9). Do not reflash.
- Useful symbols and addresses (Debug `.map`):
  - `main` 0x40–0x2AB, `initio` 0x2AC, `Reset_Handler` 0x328, `Default_Handler` 0x5FA–0x5FB, `recvbuf` 0x518–0x567, `recvval` 0x6E2–0x709 (after the T3 fix; before it: `Reset_Handler` 0x2AC, `Default_Handler` 0x5CE, `recvbuf` 0x4EC, `recvval` 0x6B6)
  - `.TI.ramfunc` loads at 0x800 (0x7CC before the T1 linker `palign(16)` fix, 0x7D0 before the T3 fix) and runs at 0x00C18000, length 0x2F0 (0x2E8 + alignment padding). `write` is at 0x00C18000 and `update` at 0x00C18260.
  - `wrp_level` = 0x20000000 (int)
  - Flash vector[0..1] = `0x20001000`, `0x00000329` (`0x000002AD` before the T3 fix)
  - DEVICEID = 0x60111004
  - WRP record page = 0x7F800–0x7FFFF (16-byte slots `{0x32EA5752, level, ~level, 0xFFFFFFFF}`)
  - SysTick CTRL/LOAD = 0xE000E010 / 0xE000E014
  - Resolve the other peripheral register addresses (UC4 UART, SYSCTL, FRI, CRCP, GSC) from the AM13E2X SDK device headers.

## **Fixed Wiring Setup**

- **JTAG (one time):** connect the LP-AM13E230 to the PC with the USB-C cable on USB1. The on-board XDS110 is serial AL130001 and the device is AM13E23019. Use the project target configuration `targetConfigs/AM13E23019.ccxml` (`TIXDS110_Connection`). Leave JP1 and JP4 populated. No per-case action is needed afterwards.
- **Serial (one time):** use the same USB-C cable. Open the XDS110 Application/User UART at **COM6** with **38400 baud, 8N1, no flow control, raw binary**. COM5 (Auxiliary Data Port) is not used. The J12 TX and RX shunts must be fitted (Rev E2 and later). On a **Rev E1** board (silkscreen `MCU178E1`), the PA0/PA1 jumper-wire workaround is required: J4-38 → XDS110 side of J12-TX, and J4-39 → XDS110 side of J12-RX. No BoosterPack and no header wiring are needed for T1–T11.

## **Prioritized Concerns**

1. **Register-level flash erase/program from RAM_C (`write()`), including the unverified `flashprep` CMDWEPROTA/B model for bank 1.** This covers the low bank-1 sector at 0x40800 and the high sector 127 used by the WRP record at 0x7F800. The plan lists it as a silicon check that is still open. If it is wrong, every app flash and every WRP change fails.
2. **App hand-off in `done:`:** the magic `0x32EA` check at 0x1000, the MSP/vector jump to 0x1800, stopping SysTick, and the resets of UC4 (new), UC0, TIMG4 and GPIO1–3. Generated `initPower` now powers UC4, UC0 and TIMG4 in every build, so all of them must be reset.
3. **WRP level record, BOOTRST and RSTCAUSE handling:** the write-once record at 0x7F800, BOOTRST, the reboot ACK after BOOTSW, level-dependent WEPROT applied on the jump (level 1 → `FPC_WEPROTA0 = 0x3`), and the F1 normalisation. That normalisation means a reboot that finds WEPROT left set by the app does a BOOTRST and then clears it. `CMD_UPDATE` must be refused at level 1.
4. **Generated init order and startup with RULE 1/2 waived.** This covers:
   - the register-level MCLK→SYSOSC switch before `SYSCFG_DL_FLASH_init` (0 wait states);
   - SDK `FLASH_init` re-enabling DLB/cache without the reference's 9-cycle wait (open silicon check);
   - the libdriverlib RAMFUNC `DL_FRI_setReadWaitStates` running from RAM_C;
   - the custom `Reset_Handler` (no `_c_int00`, no `.cinit`);
   - Flash-DED → SYSRST, where the `SYSTEMCFG.FLASHECCRSTDIS = 0` write is kept because SysConfig emits none.
5. **Default `IO_UC4` two-wire UART on the XDS110 backchannel.** Generated `SIG_UART_UC4` uses 38400 baud from SYSOSC-derived 16 MHz BUSCLK, with IBRD/FBRD 26/3 (−0.02 %). It also covers majority voting, the single-read RXDATA error check, and the J12 / Rev E1 routing. Long frames (1024 B) expose clock and baud error.
6. **CRCP via SysConfig:** CRC-32 ISO-3309, bit-reversed, little-endian, with a software final XOR and a per-call re-seed. It must equal zlib CRC-32, both on data the bootloader sends and on data it receives.
7. **SysTick 500 ms per-byte timeout** from the generated `SYSCFG_DL_SYSTICK_init()` (LOAD 15 999 999 at 32 MHz). A malformed value, a bad CRC or an unknown command must take the `done:` path without crashing.
8. **`CMD_INFO` payload:** new `IO_PIN` code **15** for `IO_UC4`, `REVISION` 4, and `DEVICEID` read from 0x60111004. Host tools must decode them.
9. **`char`-signedness / values ≥ 0x80 in `recvval()`:** `cnt` = 255 for 1024-byte blocks and `num` = 254. The code relies on tiarmclang's unsigned `char`.
10. **Variant builds that this setup cannot test:**
    - `IO_PA2`: the PF 8↔9 single-wire swap on PA26 and CTL0 TXE/MAJVOTE after the RX-only generated init.
    - `IO_TIMER`: the CC1 compare fix-up after the generated CC1 capture, the ZCOND/LACT soft-UART, and the TIMG4 timing.
    - Both need an external single-wire USB-UART.

## **Test Sequence**

**T1 — Build, flash and boot without fault**

| Input | Value |
|-------|-------|
| Setup group | `G1` |
| Automation | `auto` |
| Validates | `4` (init order, startup, RAM_C ramfunc), `2` (baseline app-area state) |
| Resources | `jtag` |
| Pre-steps | `none` |
| Execution | 1. Build the **Debug** configuration with the generated build helper.<br>2. With the generated debug helper: flash `Debug/ESCape32_boot_LP_AM13E230.out`, then halt and restart to the entry point (board known issue).<br>3. Run for 3 s with no serial traffic, then halt.<br>4. Read PC, `wrp_level` (0x20000000), the halfword at 0x1000, and 64 bytes at 0x00C18000. Compare those 64 bytes with the 64 bytes of flash at the `.TI.ramfunc` load address 0x7D0. |
| Verification | **no-crash + variable-check + memory-compare** with the generated debug helper. |
| Pass criteria | - Build has 0 errors.<br>- Load succeeds.<br>- After 3 s, PC is **not** in `Default_Handler` (0x5CE–0x5CF) or any fault handler. PC is in `main` (0x40–0x2AB) or `recvbuf`/`recvval` (0x4EC–0x53B / 0x6B6–0x6DD).<br>- RAM_C at 0x00C18000 equals flash at 0x7D0 (the `.TI.ramfunc` load address) for 64 bytes.<br>- `wrp_level` ∈ {0, 1, 2} (record and report it; it is expected to be 0 on a fresh board).<br>- Record the halfword at 0x1000. If it is `0x32EA`, a stale app is present and the core would have jumped (PC ≥ 0x1800). In that case report it and continue: T5 clears it. |
| Teardown | `none` (leave the debug session open for the following cases) |
| Spec file | `specs/t01_build_flash_boot.spec.js` |

**T2 — Generated clock, UART, SysTick, CRCP and flash-DED register state**

| Input | Value |
|-------|-------|
| Setup group | `G1` |
| Automation | `auto` |
| Validates | `4`, `5`, `6`, `7` |
| Resources | `jtag` |
| Pre-steps | `none` |
| Execution | 1. With the generated debug helper: restart to the entry point, run 1 s, then halt. If T1 found an app magic at 0x1000, set a breakpoint at `recvval` (0x6B6) and run to it instead, so the bootloader is still running its own code.<br>2. Read the registers listed under Pass criteria. |
| Verification | **memory-compare / GPIO-register-read** style register reads with the generated debug helper. |
| Pass criteria | - **SysTick:** LOAD (0xE000E014) = `0x00F423FF`. CTRL (0xE000E010) & 0x7 = `0x5` (ENABLE \| CLKSOURCE, no TICKINT).<br>- **UC4 UART:** IBRD = 26, FBRD = 3, CTL0 has ENABLE, TXE, RXE and MAJVOTE set.<br>- **SYSCTL:** MCLKCFG.USEHSCLK = 0, CLKSTATUS.HSCLKMUX = 0 (MCLK = SYSOSC). MCLK divider = DIV_2_DIV_4 (SemiMCLK = MCLK/2). SYSTEMCFG.FLASHECCRSTDIS = 0 (DED → reset).<br>- **FRI:** read wait states = 0 (FRDCNTL.WS0_MODE = 1, or RWAIT = 0 when WS0_MODE = 0) and DLB enabled. Cache enabled is required only when WS0_MODE = 0: in zero-wait-state mode the FRI holds CACHE_EN at 0 (verified on hardware during T2).<br>- **CRCP:** POLY = `0x04C11DB7`. CRCCTRL = POLYSIZE_CRC32 \| BITREVERSE_REVERSED \| LITTLE_ENDIAN, byteswap off. |
| Teardown | `none` |
| Spec file | `specs/t02_register_state.spec.js` |

**T3 — CMD_PROBE over the XDS110 backchannel**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `5`, `4` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Open COM6 (38400 8N1, raw) with the generated serial helper.<br>2. With the generated debug helper: restart to the entry point and run. Within 200 ms, flush RX (discard an optional boot ACK `00 FF`).<br>3. Send `00 FF` (PROBE).<br>4. Repeat PROBE 20 times back to back, with ≤ 100 ms between commands. |
| Verification | **serial-output**: an exact byte match on each response. |
| Pass criteria | Every PROBE returns exactly `00 FF` within 100 ms (20/20). No other bytes arrive. If there is no response at all, report the J12 shunts / Rev E1 wiring as the likely cause. |
| Teardown | `none` |
| Spec file | `specs/t03_probe.spec.js` |

**T4 — CMD_INFO payload, IO_PIN 15, DEVICEID and CRC-32 of transmitted data**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `8`, `6`, `5` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running (restart and run, flush within 200 ms).<br>2. Send `01 FE` (INFO). Read the 2 + 32 + 4 = 38 response bytes.<br>3. Halt with the generated debug helper and read the 32-bit word at 0x60111004 (DEVICEID). |
| Verification | **serial-output** (decode the data block, then compute zlib CRC-32 on the host) + **memory-compare** of DEVICEID. |
| Pass criteria | - Header `07 F8`.<br>- Byte 0 = `0x04` (REVISION).<br>- Byte 1 = `0x0F` (IO_PIN 15).<br>- Bytes 2–5 = DEVICEID read by the debugger (little-endian).<br>- Bytes 6–31 = 0.<br>- The trailing 4 bytes (LE) = `zlib.crc32(payload)`. |
| Teardown | `none` |
| Spec file | `specs/t04_info.spec.js` |

**T5 — CMD_WRITE / CMD_READ in bank 0, page erase and tail padding (also clears any stale app)**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `1`, `5`, `6`, `9` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running (restart and run, flush). **Send the first command within 200 ms**, because a stale app from T1 would otherwise take over.<br>2. WRITE `num=0` with a 1024-byte pattern `P0[i] = i & 0xFF`. The first halfword is `0x0100`, which is not the magic. This erases page 0x1000 and sends `cnt=255`.<br>3. WRITE `num=1` with a 36-byte pattern `P1[i] = (0xA5 + i) & 0xFF`. There is no erase (0x1400 is not page aligned), and the length is not a multiple of 16, so the 128-bit word is padded with 0xFF.<br>4. READ `num=0, cnt=255` and READ `num=1, cnt=8`.<br>5. Halt and read 0x1000–0x13FF and 0x1400–0x142F with the generated debug helper. |
| Verification | **serial-output** (response codes, read-back data and CRC) + **memory-compare** through the debugger. |
| Pass criteria | - Both WRITEs return `00 FF`.<br>- READ 0 returns header `FF 00`, then 1024 bytes equal to P0, then a valid CRC.<br>- READ 1 returns header `08 F7`, then 36 bytes equal to P1, then a valid CRC.<br>- Debugger memory at 0x1000 = P0 and at 0x1400 = P1.<br>- 0x1424–0x142F = `0xFFFFFFFF` × 3 (tail padding).<br>- Halfword at 0x1000 ≠ `0x32EA`. |
| Teardown | `none` (the non-magic pattern stays at 0x1000 so that T6–T9 run with no app present) |
| Spec file | `specs/t05_write_read_bank0.spec.js` |

**T6 — CMD_WRITE / CMD_READ in bank 1 (flashprep CMDWEPROTB model)**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `1`, `9` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running, with no app present (after T5).<br>2. WRITE `num=254` (address 0x40800, bank 1 sector 1, page aligned → erase) with 1024 bytes `P2[i] = (~i) & 0xFF`.<br>3. READ `num=254, cnt=255`.<br>4. Halt and read 0x40800–0x40BFF with the generated debug helper. |
| Verification | **serial-output** + **memory-compare**. |
| Pass criteria | - WRITE returns `00 FF`.<br>- READ returns `FF 00`, then P2, then a valid CRC.<br>- Debugger memory at 0x40800 equals P2.<br>- A `01 FE` result is a **failure** that points at the bank-1 `CMDWEPROTA/B` mapping in `flashprep()` (`src/util.c`). |
| Teardown | `none` |
| Spec file | `specs/t06_write_read_bank1.spec.js` |

**T7 — 500 ms per-byte SysTick timeout**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `7` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running with no app at 0x1000 (after T5). Flush.<br>2. **Within the timeout:** send `00`, wait 300 ms, send `FF`. Collect the response for 300 ms.<br>3. Stay idle for 1.2 s and flush.<br>4. **Past the timeout:** send `00`, wait 800 ms, send `FF`. Collect for 300 ms.<br>5. Stay idle for 1.2 s, flush, then send `00 FF`.<br>6. Halt and check PC with the generated debug helper. |
| Verification | **serial-output** + **no-crash**. |
| Pass criteria | - Step 2 returns `00 FF`.<br>- Step 4 returns **nothing**. The first value timed out, and the late `FF` started a value that also timed out.<br>- Step 5 returns `00 FF`.<br>- PC is not in `Default_Handler` and is < 0x1000 (still in the bootloader). |
| Teardown | `none` |
| Spec file | `specs/t07_systick_timeout.spec.js` |

**T8 — Malformed input is rejected without corrupting flash or crashing**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `6`, `7`, `2` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running with no app (after T5). Flush.<br>2. **Bad complement:** send `00 00`, wait 700 ms, then send PROBE `00 FF`.<br>3. **Bad CRC:** send WRITE `num=0` with 1024 bytes of `0x5A` and a deliberately wrong CRC (correct CRC XOR 1). Wait 700 ms, then send PROBE.<br>4. **Unknown command:** send `07 F8`, wait 700 ms, then send PROBE.<br>5. READ `num=0, cnt=255`.<br>6. Halt and check PC. |
| Verification | **serial-output** + **no-crash**. |
| Pass criteria | - No bytes are received in the 700 ms after each malformed or unknown frame (steps 2–4).<br>- Each follow-up PROBE returns `00 FF`.<br>- The READ returns the T5 pattern P0 unchanged (the bad-CRC write never touched flash).<br>- PC is not in `Default_Handler` and is < 0x1000. |
| Teardown | `none` |
| Spec file | `specs/t08_malformed_input.spec.js` |

**T9 — CMD_SETWRP off: WRP record in bank-1 sector 127, BOOTRST and reboot ACK**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `3`, `1` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running with no app (after T5). Flush.<br>2. Halt and read the WRP record page 0x7F800 to find the first free 16-byte slot (the first word that is `0xFFFFFFFF`). Read `wrp_level`. Run again and flush within 200 ms.<br>3. Send `05 FA` then `33 CC` (SETWRP off).<br>4. Wait up to 1.5 s for the reboot ACK. The firmware writes the record, then does a BOOTRST.<br>5. Reconnect or refresh the debug session if the BOOTRST dropped it. Then halt and read `wrp_level` and the slot found in step 2.<br>6. Run, then send PROBE within 200 ms. |
| Verification | **serial-output** + **variable-check** + **memory-compare**. |
| Pass criteria | - Exactly `00 FF` (reboot ACK) is received within 1.5 s of the SETWRP. `01 FE` means the record write failed (concern 1).<br>- After the reboot, `wrp_level` = 0.<br>- The new slot = `{0x32EA5752, 0x00000000, 0xFFFFFFFF, 0xFFFFFFFF}`. If the page was full, the slot is at 0x7F800 after the page erase.<br>- The final PROBE returns `00 FF`. |
| Teardown | `none` |
| Spec file | `specs/t09_setwrp_off.spec.js` |

**T10 — App hand-off at WRP level 0 (magic check, MSP/vector jump, peripheral resets)**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `2`, `1`, `3` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running at level 0 (after T9). Flush.<br>2. Install a minimal test app:<br>&nbsp;&nbsp;- WRITE `num=0` with 16 bytes `EA 32 FF FF` + `FF` × 12. This erases page 0x1000 and sets the magic.<br>&nbsp;&nbsp;- WRITE `num=2` (0x1800, page erase) with 16 bytes `00 10 00 20` `09 18 00 00` `FE E7 FE E7` `FE E7 FE E7`. That is SP = 0x20001000 and Reset = 0x1809 (Thumb), followed by `b .` at 0x1808.<br>3. READ back both blocks. **Without pausing**, send `07 F8` (unknown command → `done:`).<br>4. Wait 300 ms, then halt with the generated debug helper. Read PC, MSP, SysTick CTRL, UC4 UART CTL0, and GSC `FPC_WEPROTA0/A1/B0/B1`. |
| Verification | **memory-compare / register read** + **serial-output** (no bytes after the jump). |
| Pass criteria | - Both WRITEs return `00 FF` and the read-back matches.<br>- After `07 F8`, no serial bytes are received.<br>- PC ∈ [0x1808, 0x180B]. MSP = `0x20001000`.<br>- SysTick CTRL = 0 apart from CLKSOURCE (bit 2), which is read-as-one on this core (SYST_CALIB.NOREF = 1; verified on hardware during T10), so CTRL reads `0x4` when stopped.<br>- UC4 UART CTL0.ENABLE = 0 (module reset).<br>- All four GSC `FPC_WEPROT*` = 0 (level 0 applies no protection). |
| Teardown | 1. Reset with the generated debug helper (CPU-level reset, not System Reset) and run.<br>2. **Within 200 ms**, send PROBE (discard an optional boot ACK).<br>3. WRITE `num=0` with the 1024-byte P0 pattern to remove the magic.<br>4. Confirm by halting and reading that the halfword at 0x1000 ≠ `0x32EA`. |
| Spec file | `specs/t10_app_handoff_level0.spec.js` |

**T11 — WRP level 1: refused CMD_UPDATE, WEPROT applied on hand-off, and BOOTRST normalisation on reboot**

| Input | Value |
|-------|-------|
| Setup group | `G2` |
| Automation | `auto` |
| Validates | `3`, `2`, `1` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | 1. Bootloader running at level 0 with no app (after the T10 teardown). Flush.<br>2. Send `05 FA` then `44 BB` (SETWRP bootloader). Wait up to 1.5 s for the reboot ACK.<br>3. Reconnect if needed. Halt and read `wrp_level` and the new record slot. **Abort the case (fail) if `wrp_level` ≠ 1**, because `CMD_UPDATE` at level 0 would erase the bootloader.<br>4. Run, and within 200 ms send `04 FB` (UPDATE) followed by one data block: `00 FF` + 4 bytes `DE AD BE EF` + its CRC. Collect the responses for 500 ms.<br>5. Halt and read flash 0x0–0x7.<br>6. Run and install the T10 test app (blocks 0 and 2) within 200 ms. Then stay **idle for 1 s**, so the hand-off happens through the timeout path.<br>7. Halt and read PC and GSC `FPC_WEPROTA0/A1/B0/B1`.<br>8. Reset with the generated debug helper (CPU-level reset) and run. Collect serial for 1 s, then halt and read GSC `FPC_WEPROTA0`. |
| Verification | **serial-output** + **variable-check** + **memory-compare / register read**. |
| Pass criteria | - Step 2: reboot ACK `00 FF`.<br>- Step 3: `wrp_level` = 1, and the record slot is `{0x32EA5752, 1, 0xFFFFFFFE, 0xFFFFFFFF}`.<br>- Step 4: exactly `00 FF` (block accepted), then `01 FE` (update refused).<br>- Step 5: flash 0x0 = `0x20001000` and 0x4 = `0x00000329` (the `Reset_Handler` vector; it was `0x000002AD` before the T3 fix) (bootloader intact).<br>- Step 6: both WRITEs return `00 FF` (level 1 still allows app writes).<br>- Step 7: PC ∈ [0x1808, 0x180B]. `FPC_WEPROTA0` = `0x00000003` (sectors 0–1). A1, B0 and B1 = 0.<br>- Step 8: `FPC_WEPROTA0` = 0 after the reset (WEPROT cleared by the F1 BOOTRST normalisation or by the reset itself). Record whether a `00 FF` reboot ACK was seen and which path applied; this is informational. |
| Teardown | 1. Reset (CPU-level) and run. **Within 200 ms**, send `05 FA` `33 CC` (SETWRP off) and wait for `00 FF`.<br>2. Within 200 ms of that ACK, WRITE `num=0` with P0 to remove the app magic.<br>3. Halt and confirm `wrp_level` = 0, halfword 0x1000 ≠ `0x32EA`, and all GSC `FPC_WEPROT*` = 0. If the app took over first, repeat from step 1.<br>4. Leaving WEPROT set would block later reflashing of the bootloader until a BOOTRST or power cycle. |
| Spec file | `specs/t11_wrp_level1.spec.js` |

**T12 — Release_PA26 single-wire UART on PA26 (`IO_PA2`)**

| Input | Value |
|-------|-------|
| Setup group | `G3` |
| Automation | `stub` |
| Stub reason | `needs an external single-wire (half-duplex) 3.3 V USB-UART on PA26 (J1.2), which is not in the resource inventory` |
| Validates | `10`, `5`, `6` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | **Wiring it would need:** a 3.3 V USB-UART with TX and RX tied together through a ~1 kΩ series resistor on TX, connected to **PA26 = BoosterPack J1.2** with GND to J2.20. Confirm on the schematic that nothing on the PA26/PGA_GND net loads the pin.<br>**Steps:**<br>1. Build **Release_PA26** with the generated build helper.<br>2. Flash and restart with the generated debug helper.<br>3. Open the adapter's COM port at 38400 8N1.<br>4. Run PROBE, INFO, WRITE/READ `num=0` and the T8 malformed-frame set. The host discards its own echo (a single wire echoes TX). |
| Verification | **serial-output**, comparing bytes after the host echo is removed. |
| Pass criteria | - PROBE returns `00 FF`.<br>- INFO byte 1 = `0x0B` (IO_PIN 11), with a valid CRC.<br>- WRITE/READ round-trips.<br>- No stuck TX after `sendbuf()`: the next PROBE still works, which confirms the PF 9 → PF 8 swap back and RXE restore. |
| Teardown | Reflash the **Debug** build. |
| Spec file | `specs/t12_release_pa26_single_wire.spec.js` |

**T13 — Release_TIMER TIMG4 soft-UART on PA27 (`IO_TIMER`)**

| Input | Value |
|-------|-------|
| Setup group | `G4` |
| Automation | `stub` |
| Stub reason | `needs an external single-wire (half-duplex) 3.3 V USB-UART on PA27 (J3.27), which is not in the resource inventory` |
| Validates | `10`, `7`, `6` |
| Resources | `jtag, serial` |
| Pre-steps | `none` |
| Execution | **Wiring it would need:** the same half-duplex USB-UART as T12, on **PA27 = BoosterPack J3.27**, with GND to J2.20.<br>**Steps:**<br>1. Build **Release_TIMER** with the generated build helper.<br>2. Flash and restart with the generated debug helper.<br>3. Halt after `initio()` and read the TIMG4 CCCTL_01[1] (compare, after the fix-up) and CCCTL_01[0] (capture with ZCOND) registers.<br>4. At 38400 8N1, run PROBE ×50, INFO, and WRITE/READ of a 1024-byte block. |
| Verification | **serial-output** + register read with the generated debug helper. |
| Pass criteria | - CCCTL_01[1].COC = COMPARE and CCCTL_01[0].COC = CAPTURE.<br>- 50/50 PROBEs return `00 FF`.<br>- INFO byte 1 = `0x0E` (IO_PIN 14), with a valid CRC.<br>- A 1024-byte WRITE/READ round-trips without framing errors (soft-UART bit timing at LOAD 416 / half-bit 208). |
| Teardown | Reflash the **Debug** build. |
| Spec file | `specs/t13_release_timer_soft_uart.spec.js` |

**Not covered by this plan:**

- Flash-DED → SYSRST behaviour (would need fault injection; T2 only checks the `FLASHECCRSTDIS` bit).
- A successful `CMD_UPDATE` (it rewrites the bootloader).
- WRP level 2 (`0x55`).
