# AM13x
Custom Software on AM13x

## ESCape32 bootloader on LP-AM13E230

| Folder | Contents |
|---|---|
| `ESCape32_boot_LP_AM13E230/` | CCS project (AM13E23019, LQFP64_G, AM13E2X SDK 26.01.00.03, SysConfig). ESCape32 bootloader ported from STM32G4. Configurations: Debug/Release (UC4 two-wire UART on the XDS110 backchannel), Release_PA26 (single-wire UART on PA26), Release_TIMER (TIMG4 soft-UART on PA27). |
| `ESCape32_boot_LP_AM13E230_tests/` | Mocha hardware test suite (build, flash over XDS110, protocol tests over the backchannel UART). See its README. |

Migration details: `ESCape32_boot_LP_AM13E230/migration-report.md` and `migration-plan.md`.
Hardware test plan and results: `migration-test-plan.md` and `migration-test-report.md`.

The test project must sit next to the CCS project (it finds it at `../ESCape32_boot_LP_AM13E230`; override with `BOOT_PROJECT_DIR`). Run `npm install` in the test folder before `npm test`.

Status: Debug build verified on the LaunchPad (11/11 automated tests pass). Release_PA26 and Release_TIMER are untested on hardware.

Firmware sources are derived from ESCape32 and are licensed GPL-3.0-or-later.
