# **Migration Plan**

## **Assessment**

**ESCape32 bootloader (STM32G4, `BOOT4_PA2`) → AM13E23019 on the LP-AM13E230 LaunchPad (LQFP64_G), AM13E2X SDK 26.1.0.03.** Normal mode: path manifest `stm32-g4-targets.md` → guide dir `stm32-to-am13/`, porting mode **edit**, config mechanism **SysConfig**.

**How your feedback is applied (this is a re-plan on top of an existing port):**
1. **Reuse the reference port.** The baseline is the ported code in `C:\ti\ESCape32_boot_am13e23019`: `src/*.c`, `src/common.h`, `mcu/AM13E230X/config.{c,h}`, `startup/startup_boot.c` and `linker/boot_ticlang.cmd`, at round-3 review state. These files are grafted, not the STM32 originals. The porters only change what the LaunchPad and the real SysConfig design need. The STM32 files stay listed for semantics only. Nothing inside `C:\ti\ESCape32_boot_am13e23019` (or its `_cmake` sibling) is modified. They are read-only references.
2. **New project** `ESCape32_boot_LP_AM13E230` in the workspace. The board is LP-AM13E230 and the SDK is `C:\ti\am13e230x_sdk_26_01_00_03`.
3. **SysConfig is real this time.** Generated init is called by the firmware. The SysConfig modules for this SDK are SYSCTL (clocks, FRI wait states, flash-DED behaviour), UART/UNICOMM, SysTick (the 500 ms timeout), CRCP (CRC-32 ISO-3309) and the pins/IOMUX of every instance. These stay register-level, with the reason documented:
   - flash erase/program (there is no FLASHCTL module);
   - the GSC flash semaphore and the level-dependent WEPROT applied on the jump to the app (a `/drivers/gsc` module would apply WEPROT at init and block the bootloader's own writes);
   - the single-wire PF 8↔9 swap;
   - the TIMG4 soft-UART compare/LACT output path (`/drivers/timerPwm` is disabled in this SDK);
   - RSTCAUSE, BOOTRST and DEVICEID.
4. **Pins.** The choice below is shown for your proceed/tweak decision.
5. **4 KB budget.** See the risks below.
6. **SDK resolution and environment** (item 7) are covered in the Step 1 and Step 8 notes.

**Pin choice for the LaunchPad (proposed, edit the plan to change):**
- **Default (Debug/Release, new selector `IO_UC4`): two-wire UART on the XDS110 backchannel, UC4 TX PA0 / RX PA1, 38400 8N1.**
  - This is the AM13 version of ESCape32's own two-wire `IO_RXTX` mode. The protocol is unchanged.
  - SysConfig can model it completely, and it needs no extra wiring for host access (XDS110 virtual COM port).
  - PA0/PA1 are not on any header. They reach the XDS110 through J12 (Rev E1 boards need the jumper-wire workaround).
- **`IO_PA2` (Release_PA26): the reference single-wire design on PA26, kept as is.**
  - PA26 is on BoosterPack J1.2 / J3.22 and is free on the LaunchPad (net `PA26/A2_17/PGA_GND`; confirm on the schematic that nothing loads it).
  - SysConfig models UC0 as RX-only on PA26. The swap to PF 9 (TX) in `sendbuf()` stays register-level.
  - Host access needs a single-wire USB-UART hookup, as on a real ESC.
- **`IO_TIMER` (Release_TIMER): moved to PA27 (J3.27, TIMG4_0_CCP1), the reference `IO_PIN_PA27` option.** This keeps it off PA26, so all instances fit in one `.syscfg`.
- The pin-translation formula (PA2 → PA2) is not used. AM13 PA2 has no UC0 RX/TX pair, which is why the reference picked PA26.

**Peripheral mapping summary:**

| Source | Target | How |
|---|---|---|
| RCC HSI16→PLL 80 MHz | SYSCTL MCLK = SYSOSC 32 MHz, SemiMCLK 16 MHz, PLL/HFCLK off, FRI 0 wait states | SysConfig |
| USART2 HDSEL | UC4 two-wire / UC0 RX + PF swap | SysConfig + register-level swap |
| TIM1 timeout | SysTick 500 ms, polled COUNTFLAG | `/drivers/systick` |
| TIM3 soft-UART | TIMG4 capture on PA27 | `/drivers/timerCapture` where it fits, compare/LACT register-level |
| CRC | CRCP | `/drivers/crcp` (software final XOR and per-call seed kept) |
| FLASH and option-byte WRP | NVMNW + GSC WEPROT + 0x7F800 record | Unchanged register-level |
| RCC_CSR / AIRCR / IDCODE | RSTCAUSE / BOOTRST / DEVICEID | Unchanged register-level |

**Memory:** The 4 KB FLASH_BOOT and 4 KB RAM_BOOT layout is unchanged (the app contract is magic at 0x1000 and app vectors at 0x1800). The device has 512 KB flash and 128 KB RAM.

**Risks (informational):**
- ⚠ **4 KB FLASH_BOOT budget.** The reference `.bin` is now **2212 B** for UART and 2356 B for TIMER after the review rounds (2016 B was the pre-review figure), so about 1.7–1.9 KB is free. Generated init plus libdriverlib (for example `DL_SYSCTL_configSYSPLL`, which the template always emits, `DL_UART_setClockConfig/init` and `DL_CRCP` init) is estimated to add about 0.6–1.5 KB.
  - **Proposal: keep 4 KB as a hard gate.** Relaxing it would change the ESCape32 app layout and the host-tool offsets, so it is not recommended unless you also re-link the app. Fallbacks, in order:
    - (a) `-Oz` + gc-sections (already set);
    - (b) call the per-instance `SYSCFG_DL_*_init()` for the active variant instead of the monolithic `SYSCFG_DL_init()`, so unused variant inits are dropped;
    - (c) give a strong override of a `SYSCONFIG_WEAK` generated function (for example SYSPLL setup) with a lean equivalent;
    - (d) last resort: use only the generated macros and constants with register-level apply (as in the reference), and document it.
- ⚠ **AGENTS.md RULE 1/2 and the target manifest's Post-Build Safety Check (`Device_Init()` + `printf`) are waived again.** CIO/printf alone would exceed 4 KB, and the custom `Reset_Handler` replaces `_c_int00`. This matches the reference decision. Please confirm.
- The variant instances (UC4, UC0, TIMG4, SysTick, CRCP) are powered by the generated `initPower`. The `done:` path must reset every one of them, plus UC4, before the jump to the app.
- **RSTCAUSE is read-to-clear.** It must stay the first statement in `main()`, before any generated init.
- **Clock accuracy.** SYSOSC accuracy at 38400 baud is acceptable per the reference. The 25 MHz LaunchPad crystal (PC16/PC17) is an option for better accuracy, at a code-size cost. Not proposed.
- **`IO_PIN` codes.** A new code, 15 = UC4 two-wire, is added (the reference added 11–14). Host tools that decode `IO_PIN` need to know it.
- **Host tool behaviour.** Check that your host tool works in two-wire mode with no echo.
- All of the reference's silicon checks are still open: PF-swap turnaround, TIMG4 timing, RAM_C self-programming, WEPROT/BOOTRST, DED → SYSRST, CRC byte order.
- **SDK duplicate.** `C:\ti\am13e2x_sdk` (no prebuilt libs) is also discovered. The project must resolve to `C:\ti\am13e230x_sdk_26_01_00_03`. CMake is absent, so the build is CCS-only and the reference's CMake front-end is not reused.
- The target manifest has no Known Risk Areas list, so there are no checklist hits. Unsupported list (USB, RTC, QSPI, I3C, I2S, FlexIO, SmartDMA): none of these are used.

**Pin compatibility:** AM13E230x is pin-to-pin with STM32G474x by package (LQFP64 ↔ PM). The source part is an unknown STM32G4 and the target is a LaunchPad, so this does not apply here.

**⚠️ License Risk:**
- 6 copyleft files, 0 vendor_restrictive, 0 weak_copyleft, 0 unlicensed.
- `src/main.c`, `src/io.c`, `src/util.c`, `src/common.h`, `mcu/STM32G4/config.c` and `mcu/STM32G4/config.h` are all GPL-3.0-or-later.
- The reference-port derivatives and the new project inherit GPL-3.0-or-later. SDK driverlib and generated code (BSD-3-Clause) are compatible.
- No vendor license manifest exists for STM32, so only universal OSI patterns were checked.
- Pattern-based detection, not a legal review — verify actual license terms for these files before porting, distributing, or shipping this project.

## **Project Details**

| Field | Value |
|-------|-------|
| Source Project | `C:\ti\ESCape32\boot` |
| Source Family | `STM32` |
| Target Device | `AM13E23019` |
| Target Family | `AM13E230X` |
| Target Package | `LQFP64_G` |
| Board | `LP-AM13E230` |
| Project Name | `ESCape32_boot_LP_AM13E230` |

## **Memory**

| Resource | Source | Target | Assessment |
|----------|--------|--------|------------|
| Flash | `4 KB (bootloader region rom @0x08000000)` | `512 KB (2 × 256 KB banks, per boards/LP-AM13E230/AGENTS.md; the boot image is capped at 4 KB FLASH_BOOT @0x0)` | `⚠ Review — fits, but the 4 KB cap is tight once generated init and driverlib are linked (reference 2212 B / 2356 B without driverlib); the build-verifier enforces ≤ 4096 B` |
| RAM | `4 KB (ram @0x20000000)` | `128 KB (RAM_S 96 KB + RAM_C 32 KB); bootloader uses RAM_BOOT 4 KB + RAM_C for .TI.ramfunc` | `OK — .data + .bss ≈ 4 B in the reference; CMD_UPDATE buffer above _ram_end unchanged` |

## **SDK & Resources**

| Resource | Path |
|----------|------|
| SDK | `AM13E2X SDK 26.1.0.03` |
| SDK location | `C:\ti\am13e230x_sdk_26_01_00_03` |
| SDK supplemental dir | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK` |
| Migration guide dir | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13` |
| Path manifest | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\manifests\paths\stm32-g4-targets.md` |
| Target manifest | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\manifests\targets\am13e230x.md` |
| Board doc | `C:\ti\ccs2101\ccs\theia\resources\ai\boards\LP-AM13E230\AGENTS.md` |
| Reference port (read-only) | `C:\ti\ESCape32_boot_am13e23019` (report: `C:\ti\ESCape32_boot_am13e23019\migration-report.md`) |
| Reference projectspec (read-only) | `C:\ti\ESCape32_boot_am13e23019_cmake\ccs\ESCape32_boot_am13e23019.projectspec` |

## **Source Summary**

- Source part: `STM32G4 (generic BOOT4_PA2 build; exact part unknown, ID read at runtime)`
- Source build system: `bare-metal (CMake add_target() in C:\ti\ESCape32\CMakeLists.txt, libopencm3, arm-none-eabi-gcc)`
- Middleware: `libopencm3 (external, replaced by SDK hw_*.h + reference startup/linker), newlib-nano (toolchain; not used on ticlang)`

**Files to Copy**

These come from the reference AM13 port, by user decision. They replace the STM32 originals, which are listed after them for semantics only and are **not** grafted.

- `C:\ti\ESCape32_boot_am13e23019\src\main.c`
- `C:\ti\ESCape32_boot_am13e23019\src\io.c`
- `C:\ti\ESCape32_boot_am13e23019\src\util.c`
- `C:\ti\ESCape32_boot_am13e23019\src\common.h`
- `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.c`
- `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.h`
- `C:\ti\ESCape32_boot_am13e23019\startup\startup_boot.c`
- `C:\ti\ESCape32_boot_am13e23019\linker\boot_ticlang.cmd`

STM32 originals (semantic reference only, do not graft):

- `C:\ti\ESCape32\boot\src\main.c`
- `C:\ti\ESCape32\boot\src\io.c`
- `C:\ti\ESCape32\boot\src\util.c`
- `C:\ti\ESCape32\boot\src\common.h`
- `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`
- `C:\ti\ESCape32\boot\mcu\STM32G4\config.h`

**Build variants (one `.syscfg`, selected by CCS build configuration defines):**

| CCS configuration | Defines | Signal I/O | Pins | `IO_PIN` |
|---|---|---|---|---|
| Debug / Release (default) | none (implies `IO_UC4`) | UC4 two-wire UART 38400 8N1 | PA0 TX / PA1 RX (XDS110 VCOM) | 15 (new) |
| Release_PA26 | `-DIO_PA2` | UC0 single-wire, PF 8 (RX idle) ↔ PF 9 (TX) | PA26 (J1.2) | 11 (reference) |
| Release_TIMER | `-DIO_TIMER -DIO_PIN_PA27` | TIMG4 soft-UART, CC1 pin channel | PA27 (J3.27) | 14 (reference) |

## **Unsupported Features**

| Feature | Source Usage | Workaround |
|---------|--------------|------------|
| USART half-duplex (HDSEL) | USART2 single wire on PA2 | Default LaunchPad build: two-wire UC4 (PA0/PA1). `IO_PA2` build: reference PINCM PF 8↔9 swap on PA26 around `sendbuf()` (register-level, not modelled by SysConfig) |
| Option-byte WRP + OBL_LAUNCH | `setwrp()` | Reference design kept: write-once level record in sector 0x7F800, software enforcement, GSC FPC_WEPROT* W1S applied on the jump to the app, BOOTRST. No `/drivers/gsc` module (it would apply WEPROT at init and block the bootloader's own writes) |
| AIRCR SYSRESETREQ as full reset | After UPDATE / SETWRP | SYSCTL BOOTRST from RAM (reference) |
| RCC_CSR SFTRSTF/OBLRSTF | Reboot ACK | RSTCAUSE ∈ {BOOTSW, SYSSW, CPUSW}, read once (read-to-clear) before any generated init |
| DBGMCU_IDCODE | INFO payload | FACTORYREGION DEVICEID @0x60111004 |
| TIM slave reset-on-edge + output compare PWM2 | TIM3 soft-UART (`IO_TIMER`) | TIMG4 ZCOND capture via `/drivers/timerCapture` where possible. The compare/LACT TX path is register-level (`/drivers/timerPwm` is disabled in this SDK) |
| FLASH erase/program | `write()` / `update()` from RAM | Register-level NVMNW + GSC flash semaphore from `.TI.ramfunc` (no SysConfig flash module) |
| libopencm3 startup / linker | Entire build | Reference `startup/startup_boot.c` + `linker/boot_ticlang.cmd` (no `_c_int00`, no `Device_Init`) |
| CIO `printf` / `Device_Init()` (SDK RULE 1/2) | n/a | Waived: they do not fit in the 4 KB FLASH_BOOT, and the custom `Reset_Handler` replaces them (user to confirm) |
| CMake front-end | n/a | Not available (CMake not installed); CCS build only |

## **License Notes**

| File | Detected License | Risk Tier | Component Role | Disposition | Caveat |
|------|------------------|-----------|-----------------|--------------|--------|
| `src/main.c` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | No license manifest caveat available (manifests_dir has no licenses/); GPL-3.0 requires derived works, including the reference port and this project, to be distributed under GPL-3.0 with source |
| `src/io.c` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | Same as above |
| `src/util.c` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | Same as above |
| `src/common.h` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | Same as above |
| `mcu/STM32G4/config.c` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | Same as above |
| `mcu/STM32G4/config.h` | GPL-3.0-or-later | copyleft | | Included — no exclusion; review license terms before distribution | Same as above |

## **Pin Translation**

None. The source has no `.ioc` pin data. The STM32 → AM13E230x formula (PA2 → PA2) is not applicable: AM13 PA2 has no UC0 RX/TX pair, and it is MCPWM4_2B on the LaunchPad. The pins are chosen per the Assessment and the Build variants table. Default: UC4 PA0/PA1. Alternatives: UC0 PA26, TIMG4 PA27.

## **Sequence**

**Step 1 — Initialize the TI project.** Create the CCS project for the LaunchPad, keep the SDK empty-example `.syscfg` (already AM13E23019 / LQFP64_G), seed the migration report, and graft the **reference-port** files.

| Input | Value |
|-------|-------|
| Agent | `project-initializer` |
| Project name | `ESCape32_boot_LP_AM13E230` |
| Notes | **Project creation (preferred).** Copy the read-only reference projectspec `C:\ti\ESCape32_boot_am13e23019_cmake\ccs\ESCape32_boot_am13e23019.projectspec` to a scratch/staging location (never edit the original). In the copy: (1) rename the project to `ESCape32_boot_LP_AM13E230`; (2) keep Debug and Release with no IO define (default `IO_UC4`), keep Release_TIMER but set its defines to `-DIO_TIMER -DIO_PIN_PA27`, and add **Release_PA26** with `-DIO_PA2` (Release lib path); (3) keep the `example.syscfg` copy from `examples/empty/am13e230x_lp/m33_nortos/example.syscfg`. Then import with destination `C:\Users\anand\workspace_ccstheia\ESCape32_boot_LP_AM13E230`. **Fallback:** import the SDK empty example (`examples/empty/am13e230x_lp/m33_nortos/ti_arm_clang/example.projectspec`, after the manifest's `action="link"` check), remove `main.c` and `am13e230x_lp/app_cfg.h`, exclude the SDK `linker_m33_ti_arm_clang.cmd`, and apply the reference compiler/linker flags (`-Oz`, `-ffreestanding`, include paths, `--diag_suppress=10063`) and configurations through the project MCP (`setToolFlags`). **Graft** the reference files listed under Files to Copy, keeping their relative layout (`src/`, `mcu/AM13E230X/`, `startup/`, `linker/`), so `linker/boot_ticlang.cmd` is the only linker command file. Do **not** graft the STM32 originals. **SDK check:** after import, `getProjectProductReferences` must show `C:\ti\am13e230x_sdk_26_01_00_03` (not `C:\ti\am13e2x_sdk`). If it does not, stop and ask the user (do not modify either SDK). Record the RULE 1/2 waiver and the reuse decision in the report. |

**Step 2 — Configure `core`.** Set up the SYSCTL clock tree for the bootloader (SYSOSC MCLK), FRI wait states and flash-DED behaviour, replacing the empty example's HFCLK/PLL setup.

| Input | Value |
|-------|-------|
| Agent | `sysconfig-configurator` |
| Area | `core` |
| Peripherals | `SYSCTL (clocks, FRI/flash wait states, reset/DED behaviour), board/config` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\ecosystem.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\core-architecture.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32-hal-patterns.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\boards\LP-AM13E230\AGENTS.md` |
| Source files | Reference port (baseline): `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.c`, `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.h`, `C:\ti\ESCape32_boot_am13e23019\src\common.h`, `C:\ti\ESCape32_boot_am13e23019\example.syscfg` (inspect only, e.g. via `inspectExample`), `C:\ti\ESCape32_boot_am13e23019\migration-report.md` (SysConfig Configuration table)<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.h`, `C:\ti\ESCape32\boot\src\common.h` |
| Extracted config | Source: HSI16 → PLL 80 MHz, FLASH latency 4 + prefetch/caches; clocks FLASH, CRC, GPIOA, GPIOB, USART2, TIM1. Target (from the reference): `MCLKSource = DL_SYSCTL_MCLK_SOURCE_SYSOSC` (MCLK = CPUCLK = 32 MHz), `useHFCLK = false` (frees PC16/PC17; the 25 MHz LaunchPad crystal is not used), `SYSPLL_CLK0En = false`, `SYSPLL_CLK1En = false`, SemiMCLK = MCLK/2 = 16 MHz (UNICOMM/TIMG BUSCLK), QtrMCLK = 8 MHz, FRI read wait states 0 |
| Notes | Unlike the reference (validation-only), this config **is used**: the firmware will call the generated SYSCTL/FLASH init. Also set the SYSCTL flash-DED error behaviour to **RESET** if the module exposes it (reference round-2 F2 writes `SYSTEMCFG.FLASHECCRSTDIS = 0` at runtime; report whether SysConfig can own it). Keep NRST enabled and WWDT0 → RESET defaults. Keep VREF at its default (no analog use). Do not add `/drivers/gsc` or any NONMAIN/BCR/bootconfig module. After saving, read the generated `ti_sdk_dl_config.c` and record which DL functions `SYSCFG_DL_SYSCTL_init` / `SYSCFG_DL_FLASH_init` / `SYSCFG_DL_initPower` call (for example whether `DL_SYSCTL_configSYSPLL` is still emitted), for the 4 KB size budget. Record every resolved value in the report. |

**Step 3 — Port `core`.** Switch the reference register-level clock/FRI init to the SysConfig-generated init while keeping the reference startup, linker map, reset-cause handling and jump path.

| Input | Value |
|-------|-------|
| Agent | `area-porter` |
| Area | `core` |
| Peripherals | `SYSCTL clocks, FRI, startup/vector table, linker map, RESET_SYS (RSTCAUSE, BOOTRST, DEVICEID)` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\ecosystem.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\core-architecture.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32-hal-patterns.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md` |
| Source files | Baseline (already grafted into `project_dir`; edit these): `src/main.c`, `src/common.h`, `src/util.c` (RESET_SYS/BOOTRST parts only), `mcu/AM13E230X/config.c`, `mcu/AM13E230X/config.h`, `startup/startup_boot.c`, `linker/boot_ticlang.cmd` (originals at `C:\ti\ESCape32_boot_am13e23019\...`, read-only)<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\src\main.c`, `C:\ti\ESCape32\boot\src\util.c`, `C:\ti\ESCape32\boot\src\common.h`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.h` |
| Extracted config | `RCC_CSR` SFTRSTF/OBLRSTF check + RMVF (main.c:33-36); `SCB_AIRCR` SYSRESETREQ; `DBGMCU_IDCODE` for CMD_INFO; jump: magic 0x32ea at `_rom_end`, app vectors at `_rom_end + 2048`, `msr msp` / `bx` |
| Notes | **Minimal-delta port.**<br>(1) In `init()`, replace the reference MCLK/MCLKDIV/FRI register writes with the generated init. Preferred: call only the needed generated functions (`SYSCFG_DL_initPower`, `SYSCFG_DL_GPIO_init`, `SYSCFG_DL_SYSCTL_init`, plus `SYSCFG_DL_FLASH_init` if emitted). The per-variant peripheral inits are called by signal-io/flash-crc. Calling the monolithic `SYSCFG_DL_init()` is acceptable only if the size budget allows. Include `ti_sdk_dl_config.h` through `common.h`.<br>(2) Keep `RSTCAUSE` as the **first** statement of `main()`, before any generated init, and keep the WEPROT/BOOTRST normalisation (reference F1) ahead of it as today.<br>(3) Keep `startup_boot.c` (no `_c_int00`, `Device_Init`, `printf` or CIO; RULE 1/2 waived). Make sure the libdriverlib `.TI.ramfunc` objects (for example the RAMFUNC `DL_FRI_setReadWaitStates`) are covered by the existing `.TI.ramfunc` load-FLASH_BOOT / run-RAM_C placement in `boot_ticlang.cmd`. The generated code must not need `.cinit`.<br>(4) If the generated flash-DED setting replaces the reference SYSTEMCFG write, keep the write anyway when the generated init runs after the record scan (the order must guarantee DED → RESET before the scan).<br>(5) In the `done:` path, reset every peripheral that generated `initPower` enabled (UC4, UC0, TIMG4, CRCP as applicable) and stop SysTick before the jump. The app contract is unchanged: `_rom_end` 0x1000, `_ram_end` 0x20001000.<br>(6) Remove the `#error` on `IO_RXTX` only if signal-io needs it. Otherwise leave the selector logic to signal-io.<br>Keep all ESCape32 identifiers, `REVISION` and comments. |

**Step 4 — Configure `signal-io`.** Model the LaunchPad UART/timer instances and pins in SysConfig, plus the 500 ms SysTick timeout.

| Input | Value |
|-------|-------|
| Agent | `sysconfig-configurator` |
| Area | `signal-io` |
| Peripherals | `UART (UNICOMM UC4, UC0), GPIO/IOMUX pins, TIMER (SysTick timeout; TIMG4 capture for IO_TIMER)` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\UNICOMM.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\UART.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\TIMERS.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-uart-api-reference.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-gpio-api-reference.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-timer-api-reference.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\peripherals\UART.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\boards\LP-AM13E230\AGENTS.md` |
| Source files | Baseline: `C:\ti\ESCape32_boot_am13e23019\src\io.c`, `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.h`, `C:\ti\ESCape32_boot_am13e23019\migration-report.md` (scratch UART/timer SysConfig values)<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\src\io.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\src\main.c` |
| Extracted config | USART2 38400 8N1, polled, RX off while sending, TX waits TC, FE/NF abort. TIM1: 10 kHz tick, ARR 4999 → 500 ms, UIF polled, UG restart per byte. TIM3 (`IO_TIMER`): bit time @38400, half-bit compare, reset on any edge, falling-edge capture, IC filter 8 clocks. Reference values: UART BUSCLK 16 MHz, OVS 16×, IBRD 26 / FBRD 3 (38392 baud, −0.02 %); TIMG4 BUSCLK 16 MHz, LOAD 416, half-bit 208; SysTick 16 000 000 counts @32 MHz = 500 ms |
| Notes | Add these instances to the **one** project `.syscfg` (all coexist, with no pad conflicts):<br>(a) **`SIG_UART_UC4`**: `/drivers/uart` on **UC4**, TX **PA0**, RX **PA1** (LaunchPad backchannel), TX_RX, 38400, 8N1, no flow control, BUSCLK /1, OVS 16× (confirm IBRD/FBRD = 26/3), no interrupts or DMA.<br>(b) **`SIG_UART_PA26`**: `/drivers/uart` on **UC0**, direction **RX only**, RX **PA26** with pull-up, same frame/baud. The PF 9 TX swap stays register-level. If RX-only cannot pin UC0 to PA26, report it and leave PA26 register-level as in the reference.<br>(c) **`SIG_TIMER`**: `/drivers/timerCapture` on **TIMG4**, CCP1 on **PA27** (pull-up), BUSCLK 16 MHz, prescale 0, period 26.0417 µs (LOAD 416), PERIOD_CAPTURE_UP + EDGE (ZCOND reset), polled. Report which TIMG4 settings can't be expressed (the compare/LACT TX path; `/drivers/timerPwm` is disabled).<br>(d) **`/drivers/systick`**: period 16 000 000 counts (500 ms at MCLK 32 MHz), no interrupt, not auto-started if selectable.<br>Verify each instance's resolved UNICOMM/TIMG instance and pin (UC4 must not drift). There is no DMA, so RULE 5 does not apply. Record the generated macro names (`*_INST`, `*_BAUD_RATE`, IOMUX `*_IOMUX`/`*_PINCM`, init function names) for the porter. |

**Step 5 — Port `signal-io`.** Add the default UC4 two-wire path, move the single-wire and timer paths onto SysConfig-generated init, and keep the register-level pieces SysConfig can't model.

| Input | Value |
|-------|-------|
| Agent | `area-porter` |
| Area | `signal-io` |
| Peripherals | `UART (UC4 two-wire, UC0 single-wire), GPIO/IOMUX, TIMER (SysTick timeout, TIMG4 soft-UART)` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\UNICOMM.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\UART.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\stm32-to-am13\peripherals\TIMERS.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-uart-api-reference.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-gpio-api-reference.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-timer-api-reference.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\peripherals\UART.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\peripherals\GPIO.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\boards\LP-AM13E230\AGENTS.md` |
| Source files | Baseline (grafted; edit these): `src/io.c`, `src/common.h` (`IO_PIN`/`TIM3_IDR` block), `mcu/AM13E230X/config.h` (selectors/pin table), `src/main.c` (`done:` resets only)<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\src\io.c` (including the `IO_RXTX` two-wire branch), `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\src\main.c` |
| Extracted config | See the Step 4 Extracted config. Two-wire semantics come from the source `IO_RXTX` branch: TX and RX on separate pins, no HDSEL. Auto-detect is not needed on the LaunchPad |
| Notes | (1) In `config.h`, the selectors become: default `IO_UC4` (when neither `IO_PA2` nor `IO_TIMER` is defined); `IO_PA2` = UC0 single-wire on PA26; `IO_TIMER` (+ `IO_PIN_PA27`) = TIMG4 on PA27. Mutual-exclusion `#error`s are kept. `IO_RXTX` stays unsupported.<br>(2) `initio()` calls the generated per-instance init for the active variant (`SYSCFG_DL_<SIG_UART_UC4>_init` / `..._PA26_init` / `SYSCFG_DL_<SIG_TIMER>_init`, plus the SysTick init) instead of the reference RSTCTL/PWREN/IBRD/FBRD/PINCM writes. Use generated macros (`*_INST`, IOMUX PINCM, baud constants) wherever register-level code remains.<br>(3) **`IO_UC4`:** `recvbuf()`/`sendbuf()` use UC4 with polled `STAT`/`RXDATA` (keep the reference round-1 F6 single-read error check). Toggling RX during TX is optional (no echo on two wires). End TX on `STAT.BUSY == 0`.<br>(4) **`IO_PA2`:** keep the reference PF 8↔9 swap and CTL0/TXE sequence (N1a) unchanged; only the init source changes.<br>(5) **`IO_TIMER`:** keep the reference compare/LACT/ZCOND register code. The pin channel is CC1 on PA27.<br>(6) Timeout: SysTick 500 ms, `VAL = 0` restart per byte, `COUNTFLAG` poll (reference behaviour).<br>(7) `common.h`: add `IO_PIN` **15** for `IO_UC4`; keep 11–14.<br>(8) In `main.c` `done:`, also reset UC4. Keep `recvval`/`sendval`/`recvdata`/`senddata` and all identifiers unchanged. |

**Step 6 — Configure `flash-crc`.** Model the CRC engine in SysConfig; confirm that flash, semaphore and WEPROT stay outside SysConfig.

| Input | Value |
|-------|-------|
| Agent | `sysconfig-configurator` |
| Area | `flash-crc` |
| Peripherals | `CRC (CRCP), FLASH (NVMNW/FLASHCTL), GSC write-protect/semaphore` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\crc-migration-notes.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-flash-api-reference.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md` |
| Source files | Baseline: `C:\ti\ESCape32_boot_am13e23019\src\util.c`, `C:\ti\ESCape32_boot_am13e23019\src\main.c`, `C:\ti\ESCape32_boot_am13e23019\mcu\AM13E230X\config.h`<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\src\util.c`, `C:\ti\ESCape32\boot\src\main.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.h` |
| Extracted config | CRC: poly 0x04C11DB7, CR = RESET \| REV_IN_WORD \| REV_OUT, word feed, result ~DR (zlib CRC-32). FLASH: 2 KB page erase, 64-bit program, option-byte WRP (WRP1AR + OPTSTRT + OBL_LAUNCH); write/update run from RAM |
| Notes | Add **`/drivers/crcp`** with profile **CRC-32 ISO-3309** (poly 0x04C11DB7, seed 0xFFFFFFFF), bit reverse **REVERSED**, endianness **LITTLE**, matching the reference `CRCCTRL`. Record the generated init name and macros. Do **not** add `/drivers/gsc` (static WEPROT/privilege at init conflicts with the bootloader's runtime, level-dependent WEPROT and its own flash writes). There is no flash module. Document both as register-level by necessity. Check that the RAM_C/flash-related SYSCTL settings from core are unchanged. |

**Step 7 — Port `flash-crc`.** Use the generated CRCP init and keep the reference flash, WRP and WEPROT code.

| Input | Value |
|-------|-------|
| Agent | `area-porter` |
| Area | `flash-crc` |
| Peripherals | `CRC (CRCP), FLASH (NVMNW), GSC WEPROT + flash semaphore, BOOTRST` |
| Guides | `C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\crc-migration-notes.md`<br>`C:\ti\ccs2101\ccs\theia\resources\ai\migration-guides\common\stm32\stm32_0\stm32-flash-api-reference.md` |
| SDK reference | `C:\ti\ccs2101\ccs\theia\resources\ai\sdks\AM13E2X-SDK\AGENTS.md` |
| Source files | Baseline (grafted; edit these): `src/util.c`, `src/main.c`, `src/common.h`, `mcu/AM13E230X/config.c` (CRCP reset/power), `mcu/AM13E230X/config.h`<br>STM32 originals (semantics): `C:\ti\ESCape32\boot\src\util.c`, `C:\ti\ESCape32\boot\src\main.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.c`, `C:\ti\ESCape32\boot\mcu\STM32G4\config.h` |
| Extracted config | See the Step 6 Extracted config |
| Notes | (1) Replace the reference CRCP reset/power/CRCCTRL/POLY setup in `init()`/`crc32()` with the generated CRCP init (called once from `init()`). `crc32()` must still re-seed 0xFFFFFFFF on every call, feed words to `CRCIN` and return `~CRCOUT` (software final XOR). Keep `-DCRC_SELFTEST` (expect 0x9AE0DAAF).<br>(2) Leave `write()`/`update()`/`setwrp()`, the 0x7F800 record, GSC semaphore/WEPROT, BOOTRST and round 1–3 fixes **unchanged**. `write`/`update` must stay call-free outside RAM_C (only `bl write`). Generated code must not be called from `.TI.ramfunc`.<br>(3) Confirm that the generated init does not touch NVMNW/GSC registers. |

**Step 8 — Build and verify.** Build the ported project, fix build failures in place until it passes, and enforce the bootloader size and layout gates.

| Input | Value |
|-------|-------|
| Agent | `build-verifier` |
| Notes | Build **all four** configurations (Debug, Release, Release_PA26, Release_TIMER) through CCS with 0 errors and 0 warnings. **Gates (from the reference criteria C):**<br>- each `.bin` ≤ **4096 B**;<br>- `.vectors` at 0x0 with vector[0] = 0x20001000 and vector[1] = `Reset_Handler`\|1;<br>- `_rom_end` = 0x1000;<br>- `write`/`update` in RAM_C 0x00C18xxx and call-free outside RAM;<br>- no `_c_int00`, `__TI_auto_init`, `Device_Init`, `printf` or CIO;<br>- `.cinit` 0 B;<br>- the linker map shows the generated `SYSCFG_DL_*` functions and libdriverlib objects actually linked, with sizes recorded per config.<br>**Size fallback** (only in this order, and report each step): (b) per-instance init instead of `SYSCFG_DL_init`, (c) a strong override of a heavy `SYSCONFIG_WEAK` function, (d) generated macros with register-level apply for the offending module. Do not relax FLASH_BOOT without user approval. **Environment:** CCS 21.0.1 / SysConfig 1.28.1 / tiarmclang 5.1.1. CMake is not installed, so CCS build only. Every compile/link line must reference `C:/ti/am13e230x_sdk_26_01_00_03`. If it reverts to `C:/ti/am13e2x_sdk` (stale product discovery, see the reference report Attempts 1–4), stop and ask the user rather than touching SDKs or CCS preferences. Compare sizes with the reference (2212 / 2356 B) in the report. |
