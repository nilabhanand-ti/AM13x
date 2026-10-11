'use strict';
/** Data patterns from the plan (T5, T6, T8, T10). */

const fill = (len, fn) => Buffer.from(Array.from({ length: len }, (_, i) => fn(i) & 0xff));

module.exports = {
  /** T5: 1024 bytes, P0[i] = i & 0xFF (first halfword 0x0100, not the app magic). */
  P0: fill(1024, (i) => i),
  /** T5: 36 bytes, P1[i] = (0xA5 + i) & 0xFF (not a multiple of 16 -> 0xFF tail padding). */
  P1: fill(36, (i) => 0xa5 + i),
  /** T6: 1024 bytes, P2[i] = (~i) & 0xFF. */
  P2: fill(1024, (i) => ~i),
  /** T8: 1024 bytes of 0x5A (sent with a deliberately wrong CRC). */
  BAD_CRC_DATA: fill(1024, () => 0x5a),
  /** T10/T11 test app, block 0 (0x1000): app magic 0x32EA + 0xFF padding. */
  APP_BLOCK0: Buffer.from([0xea, 0x32, 0xff, 0xff, ...Array(12).fill(0xff)]),
  /** T10/T11 test app, block 2 (0x1800): SP=0x20001000, Reset=0x1809, then `b .` at 0x1808. */
  APP_BLOCK2: Buffer.from([
    0x00, 0x10, 0x00, 0x20,
    0x09, 0x18, 0x00, 0x00,
    0xfe, 0xe7, 0xfe, 0xe7,
    0xfe, 0xe7, 0xfe, 0xe7,
  ]),
  /** T11: payload of the single CMD_UPDATE block (must be refused at WRP level 1). */
  UPDATE_BLOCK: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
};
