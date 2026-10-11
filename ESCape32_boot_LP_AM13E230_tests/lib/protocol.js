'use strict';
/**
 * ESCape32 bootloader host protocol (binary, no text) - see the plan's Test Strategy.
 *
 *  value      : [v, v ^ 0xFF]          RES_OK = 00 FF, RES_ERROR = 01 FE
 *  data block : value(len/4 - 1), len bytes, CRC-32 (zlib/ISO-3309) little-endian
 *  commands   : PROBE 0, INFO 1, READ 2, WRITE 3, UPDATE 4, SETWRP 5
 */
const cfg = require('../config');

const CMD = { PROBE: 0, INFO: 1, READ: 2, WRITE: 3, UPDATE: 4, SETWRP: 5 };
const RES_OK = Buffer.from([0x00, 0xff]);
const RES_ERROR = Buffer.from([0x01, 0xfe]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard zlib / ISO-3309 CRC-32 (same as zlib.crc32 / binascii.crc32). */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function value(v) {
  return Buffer.from([v & 0xff, (v ^ 0xff) & 0xff]);
}

function u32le(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

/** Encode a data block. `crcXor` deliberately corrupts the CRC (T8). */
function block(data, { crcXor = 0 } = {}) {
  const buf = Buffer.from(data);
  if (buf.length === 0 || buf.length % 4 !== 0 || buf.length > 1024) {
    throw new Error(`data block length ${buf.length} must be a non-zero multiple of 4 and <= 1024`);
  }
  return Buffer.concat([value(buf.length / 4 - 1), buf, u32le((crc32(buf) ^ crcXor) >>> 0)]);
}

/** Decode a received data block of `len` payload bytes. */
function parseBlock(raw, len) {
  const header = raw.subarray(0, 2);
  const data = raw.subarray(2, 2 + len);
  const crcBytes = raw.subarray(2 + len, 6 + len);
  const complete = raw.length === len + 6;
  const crcRx = crcBytes.length === 4 ? crcBytes.readUInt32LE(0) : null;
  const crcCalc = crc32(data);
  return {
    raw,
    complete,
    header: Buffer.from(header),
    expectedHeader: value(len / 4 - 1),
    headerOk: header.equals(value(len / 4 - 1)),
    data: Buffer.from(data),
    crcRx,
    crcCalc,
    crcOk: complete && crcRx === crcCalc,
  };
}

const hex = (buf) => (buf.length ? Buffer.from(buf).toString('hex').replace(/(..)(?!$)/g, '$1 ') : '<nothing>');

/** Thin command layer over a BootSerial. */
class Bootloader {
  constructor(serial) {
    this.serial = serial;
  }

  async send(bytes) {
    await this.serial.write(bytes);
  }

  async probe(timeoutMs = cfg.timing.probeResponse) {
    await this.send(value(CMD.PROBE));
    return this.serial.readExact(2, timeoutMs);
  }

  /**
   * PROBE right after a reset: one leading 00 FF reboot ACK may precede the answer.
   * Returns { response, discardedAck }.
   */
  async probeTolerant(timeoutMs = cfg.timing.probeResponse) {
    const response = await this.probe(timeoutMs);
    const extra = await this.serial.collect(cfg.timing.bootAckDiscardWindow);
    if (extra.length === 0) return { response, discardedAck: false, extra };
    if (extra.equals(RES_OK) && response.equals(RES_OK)) return { response, discardedAck: true, extra };
    return { response: Buffer.concat([response, extra]), discardedAck: false, extra };
  }

  async info(timeoutMs = cfg.timing.infoResponse) {
    await this.send(value(CMD.INFO));
    return parseBlock(await this.serial.readExact(38, timeoutMs), 32);
  }

  async read(num, cnt, timeoutMs = cfg.timing.readResponse) {
    await this.send(Buffer.concat([value(CMD.READ), value(num), value(cnt)]));
    const len = (cnt + 1) * 4;
    return parseBlock(await this.serial.readExact(len + 6, timeoutMs), len);
  }

  async write(num, data, { crcXor = 0, timeoutMs = cfg.timing.writeResponse } = {}) {
    await this.send(Buffer.concat([value(CMD.WRITE), value(num), block(data, { crcXor })]));
    return this.serial.readExact(2, timeoutMs);
  }

  /** WRITE whose response may be preceded by one leading 00 FF reboot ACK. */
  async writeTolerant(num, data, timeoutMs = cfg.timing.writeResponse) {
    const response = await this.write(num, data, { timeoutMs });
    const extra = await this.serial.collect(cfg.timing.bootAckDiscardWindow);
    if (extra.length === 0) return response;
    if (response.equals(RES_OK) && (extra.equals(RES_OK) || extra.equals(RES_ERROR))) return extra;
    return Buffer.concat([response, extra]);
  }
}

module.exports = { CMD, RES_OK, RES_ERROR, crc32, value, block, parseBlock, u32le, hex, Bootloader };
