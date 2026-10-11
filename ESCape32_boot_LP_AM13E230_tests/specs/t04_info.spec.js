'use strict';
/**
 * T4 - CMD_INFO payload, IO_PIN 15, DEVICEID and CRC-32 of transmitted data
 * Validates concerns 8, 6, 5. Resources: jtag, serial. Setup group G2.
 */
const assert = require('node:assert/strict');
const cfg = require('../config');
const dbg = require('../lib/debug');
const fx = require('../lib/fixture');
const { hex } = require('../lib/protocol');

const ID = 'T4';

describe('T4 - CMD_INFO payload, IO_PIN 15, DEVICEID and CRC-32 of transmitted data', function () {
  let ser;
  let boot;

  before(async function () {
    await fx.prepareTarget();
    ({ ser, boot } = await fx.prepareSerial());
  });

  it('returns REVISION 4, IO_PIN 15, the DEVICEID and a valid zlib CRC-32', async function () {
    // Step 1: bootloader running (restart and run, flush within 200 ms).
    await fx.startBootloader(ser);

    // Step 2: INFO -> 2 + 32 + 4 = 38 bytes.
    const r = await boot.info();
    fx.log(ID, `INFO response (${r.raw.length} B): ${hex(r.raw)}`);

    // Step 3: halt and read DEVICEID (0x60111004).
    dbg.halt();
    const deviceId = dbg.readU32(cfg.addr.deviceId);
    fx.log(ID, `DEVICEID (debugger) = ${fx.h(deviceId)}`);

    assert.ok(r.complete, `expected 38 bytes, received ${r.raw.length}: ${hex(r.raw)}`);
    assert.equal(hex(r.header), '07 f8', 'data block header');
    assert.equal(r.data[0], cfg.boot.revision, 'byte 0 (REVISION)');
    assert.equal(r.data[1], cfg.boot.ioPinUc4, 'byte 1 (IO_PIN, IO_UC4 = 15)');
    assert.equal(r.data.readUInt32LE(2), deviceId,
      `bytes 2-5 = ${fx.h(r.data.readUInt32LE(2))}, debugger DEVICEID = ${fx.h(deviceId)}`);
    assert.ok(r.data.subarray(6, 32).every((b) => b === 0), `bytes 6-31 not all zero: ${hex(r.data.subarray(6, 32))}`);
    assert.ok(r.crcOk, `CRC: received ${fx.h(r.crcRx ?? 0)}, zlib.crc32(payload) = ${fx.h(r.crcCalc)}`);
  });
});
