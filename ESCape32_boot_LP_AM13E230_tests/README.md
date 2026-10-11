# ESCape32 bootloader on LP-AM13E230: hardware test suite (JavaScript / Mocha)

This is a standalone test project for the hardware test plan in
`../ESCape32_boot_LP_AM13E230/migration-test-plan.md`. There is one Mocha spec per plan case (T1 to T13). The specs
drive the LaunchPad over two channels (listed below).

**Location.** This test project lives at `C:/Users/anand/workspace_ccstheia/ESCape32_boot_LP_AM13E230_tests`, a
sibling of the CCS project, **not** inside it. A `tests/` folder inside the CCS project makes the
CDT managed build compile `node_modules/@serialport/bindings-cpp/src/*.cpp` and break the firmware
link. `config.js` resolves the CCS project as `../ESCape32_boot_LP_AM13E230` (override with
`BOOT_PROJECT_DIR`).

The two channels are:

- **JTAG/SWD**, through the CCS scripting API. The API is called in-process by
  `require()`-ing `C:/ti/ccs2101/ccs/scripting/node_modules/scripting`.
- **The XDS110 backchannel UART** (COM6, 38400 8N1, raw binary), through `serialport`.

Builds go through the CCS headless CLI (`ccs-server-cli.bat`).

## Prerequisites

- **CCStudio IDE 21.0.1** at `C:/ti/ccs2101`. To use another location, set `CCS_INSTALL_DIR`.
- **System Node.js with npm**, used only to install dependencies. The tests themselves
  run under the CCS-bundled Node.js (`C:/ti/ccs2101/ccs/tools/node/node.exe`, v22.7.0).
- **An LP-AM13E230** connected over USB-C (USB1). Wire it as described in the plan's
  *Fixed Wiring Setup*:
  - JP1 and JP4 are populated.
  - The J12 TX and RX shunts are fitted.
  - On a **Rev E1** board, the PA0/PA1 jumper-wire workaround is in place.
- **The `ESCape32_boot_LP_AM13E230` project** is imported in the CCS workspace
  `C:/Users/anand/workspace_ccstheia`, and **Debug is its active build configuration**.
  The build helper builds the active configuration.

## Install

```sh
cd C:/Users/anand/workspace_ccstheia/ESCape32_boot_LP_AM13E230_tests
npm install
```

The installed dependencies are:

| Package | Role |
|---|---|
| `mocha@11` | Test framework |
| `mocha-multi-reporters` | Runs several reporters at once (see *Results*) |
| `serialport` | Serial library (COM6) |

`mocha@11` is pinned on purpose. Mocha 12 is ESM-only and needs Node >= 22.12, but the
CCS-bundled Node is 22.7.0. `npm audit` reports advisories against Mocha 11's own
dependencies (`diff`, `serialize-javascript`, which is used only in parallel mode). They
are development-only and do not affect this suite.

## Run

Close any CCS debug session on the board first, and close any terminal holding COM6.
Then run:

```sh
npm test                                 # full sequence T1..T13, under the CCS-bundled Node
npm test -- --grep "T5 "                 # a single case
npm test -- --bail                       # stop at the first failure
npm run test:list                        # list the cases (Mocha --dry-run; nothing is built, flashed or run)
```

You can also run Mocha directly under the bundled Node:
`"C:/ti/ccs2101/ccs/tools/node/node.exe" node_modules/mocha/bin/mocha.js`.

The following environment variables override the defaults in `config.js`:

| Variable | Default | Purpose |
|---|---|---|
| `CCS_INSTALL_DIR` | `C:/ti/ccs2101` | CCS install root (scripting API, CLI, Node) |
| `BOOT_PROJECT_DIR` | `../ESCape32_boot_LP_AM13E230` | The CCS project folder (holds `Debug/*.out` and `targetConfigs/*.ccxml`) |
| `CCS_WORKSPACE` | the parent of the project dir | `-workspace` for `ccs-server-cli` |
| `BOOT_COM_PORT` | `COM6` | XDS110 Application/User UART |
| `DEBUG_CORE_PATTERN` | `cortex` | Regex used to pick the core to open the session on |
| `CCS_SCRIPTING_VERBOSE` | unset | Set it to print debugger status and GEL messages |

### Order matters

The cases form one sequence, and later cases rely on the target state that earlier
cases leave behind:

- T5 leaves the non-magic pattern P0 at 0x1000.
- T9 sets WRP level 0.
- The T10 and T11 teardowns remove the test app and restore level 0.

Files are sorted (`t01` … `t13`) and never run in parallel. If you run a single case with
`--grep`, it still builds and flashes. T6 to T11 check their precondition (no app magic at
0x1000) and fail with a clear message if T5 has not been run first.

## How it works

| File | Purpose |
|---|---|
| `config.js` | **The only configuration file.** It holds paths, the COM port, timing, and the plan's addresses and symbols (from the Debug `.map`). It also holds the register addresses and bitfields, resolved from the AM13E2X SDK `source/device/am13e230x/include/hw/hw_*.h`. |
| `lib/build.js` | Runs `ccs-server-cli.bat` with exactly `-workspace <ws> -application projectBuild -ccs.locations <project dir> -ccs.autoImport -ccs.configuration Debug -ccs.listProblems`. It streams the output and fails loudly on any of the following: <br>- a non-zero exit code <br>- "build failed to run to completion" <br>- "N out of M projects have errors" with N > 0 <br>- a problem summary with more than 0 errors <br>- compiler `error:` / `error #` lines <br>- `gmake *** Error` lines <br>- a missing `Debug/*.out` |
| `lib/debug.js` | The CCS scripting session: configure the `.ccxml`, open the Cortex-M33 session, connect, and load the program once. It also provides halt, restart to `Reset_Handler`, run, CPU-level reset, memory and register reads, breakpoints, and post-BOOTRST reconnect. |
| `lib/serial.js` | Raw COM6 access: open, flush, write, `readExact(n, timeout)`, and `collect(ms)`. |
| `lib/protocol.js` | The ESCape32 binary protocol: the value and data-block encoding, zlib CRC-32, and PROBE / INFO / READ / WRITE. |
| `lib/patterns.js` | The plan's data patterns: P0, P1, P2, the bad-CRC data, the T10 test app, and the UPDATE block. |
| `lib/fixture.js` | Case setup (build, then flash), starting the bootloader inside the 200 ms window, and state readers (PC ranges, WRP record slots, GSC WEPROT). |
| `lib/hooks.js` | Root `afterAll`: closes COM6 and shuts the scripting session down. |
| `specs/tNN_*.spec.js` | One spec per plan case. |

The board rules from the plan and the LP-AM13E230 `AGENTS.md` are built into the helpers:

- The program is loaded once, into a fresh session, and is then halted and restarted to
  the entry point.
- **"System Reset" is never used.** The CPU-level reset is "CPU Subsystem Reset".
- **SYSCTL RSTCAUSE is never read**, because it is read-to-clear.
- After a BOOTRST (T9, T11), the session reconnects (or re-opens and reloads symbols)
  **without reflashing**.

**Debug session lifetime.** Every case in this plan uses `jtag`, so the first case opens
one scripting session and holds it for the whole run. It is shut down in the root
`afterAll` hook.

**Build per case.** Every case's `before` hook calls the build helper before flashing.
The headless build runs once per Mocha run, and later cases share its result. The first
case to run flashes the image. Later cases keep the target state the sequence depends on.

The scripting API is synchronous: it blocks the Node event loop during a call. Serial
bytes received in the meantime are buffered by the OS. This is why the helpers never put
a debugger call inside a serial timing window.

## Results

The suite uses `mocha-multi-reporters` to run two reporters together:

- **`spec`**: the human-readable console output, including every `[Tn]` diagnostic line.
- **Mocha's built-in `json` reporter**: written to **`ESCape32_boot_LP_AM13E230_tests/results/results.json`**.

A small adapter, `lib/json-file-reporter.js`, is needed for the JSON file.
`mocha-multi-reporters` passes `reporterOptions` to each reporter, but Mocha 11's JSON
reporter only reads `reporterOption.output`. Without the adapter, the JSON would go to
stdout and no file would be written. The configuration lives in
`.mocha-multi-reporters.json` and `.mocharc.cjs`.

The scripting API log is written to `ESCape32_boot_LP_AM13E230_tests/results/scripting.log`.

## Stub cases

| Case | Why it is a stub | What it needs |
|---|---|---|
| T12 (Release_PA26, `IO_PA2`) | It needs an external single-wire (half-duplex) 3.3 V USB-UART on PA26 (J1.2), which is not in the resource inventory. | TX and RX tied through ~1 kΩ on TX to **PA26 = J1.2**, with GND to J2.20 |
| T13 (Release_TIMER, `IO_TIMER`) | It needs an external single-wire (half-duplex) 3.3 V USB-UART on PA27 (J3.27), which is not in the resource inventory. | The same adapter on **PA27 = J3.27**, with GND to J2.20 |

Both are `it.skip` specs, and their header comments list the steps and pass criteria. To
implement one:

1. Make the release configuration active.
2. Point a second `BootSerial` (`lib/serial.js`) at the adapter's COM port.
3. Drop the host echo before decoding responses.
4. Reflash Debug in teardown.

No case uses a bench instrument. This project has no instrument integration and no
output-voltage guard.

## Adding a case

1. Add a row to `## Test Sequence` in `../ESCape32_boot_LP_AM13E230/migration-test-plan.md`, including a `Spec file` row.
2. Create `specs/tNN_<name>.spec.js`. The `NN` prefix sets where the case runs in the sequence.
3. Follow this skeleton:

   ```js
   const assert = require('node:assert/strict');
   const fx = require('../lib/fixture');
   describe('T14 - ...', function () {
     let ser, boot;
     before(async function () {
       await fx.prepareTarget();                       // build, then flash (once per run)
       ({ ser, boot } = await fx.prepareSerial());     // only if the case uses serial
     });
     it('...', async function () {
       await fx.startBootloader(ser);                  // restart + run + flush (< 200 ms)
       const resp = await boot.probe();
       assert.equal(resp.toString('hex'), '00ff');
     });
     after(async function () { /* teardown: restore the state later cases expect */ });
   });
   ```

4. Put any new address or register in `config.js`, not in the spec.
