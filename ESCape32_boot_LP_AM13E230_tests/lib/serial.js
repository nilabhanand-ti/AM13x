'use strict';
/**
 * Serial helper: raw binary access to the XDS110 Application/User UART
 * (COM6, 38400 8N1, no flow control, no newline translation) using `serialport`.
 *
 * Received bytes are accumulated in an internal buffer; readExact()/collect()
 * consume from it. flush() discards everything received so far.
 */
const { SerialPort } = require('serialport');
const cfg = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BootSerial {
  constructor(options = cfg.serial) {
    this.options = options;
    this.port = null;
    this.rx = Buffer.alloc(0);
  }

  get isOpen() {
    return Boolean(this.port && this.port.isOpen);
  }

  async open() {
    if (this.isOpen) return;
    const o = this.options;
    this.port = new SerialPort({
      path: o.path,
      baudRate: o.baudRate,
      dataBits: o.dataBits,
      parity: o.parity,
      stopBits: o.stopBits,
      rtscts: false,
      xon: false,
      xoff: false,
      autoOpen: false,
    });
    await new Promise((resolve, reject) => this.port.open((err) => (err
      ? reject(new Error(`Cannot open ${o.path} (${o.baudRate} 8N1): ${err.message}`))
      : resolve())));
    this.port.on('data', (d) => { this.rx = Buffer.concat([this.rx, d]); });
    this.rx = Buffer.alloc(0);
  }

  async close() {
    if (!this.isOpen) return;
    await new Promise((resolve) => this.port.close(() => resolve()));
    this.port = null;
  }

  /** Discard everything received so far (driver buffers and our own). */
  async flush() {
    await new Promise((r) => setImmediate(r)); // let pending 'data' events land first
    await new Promise((resolve) => this.port.flush(() => resolve()));
    this.rx = Buffer.alloc(0);
  }

  /** Write bytes and wait until they have been handed to the driver. */
  async write(bytes) {
    const buf = Buffer.from(bytes);
    await new Promise((resolve, reject) => this.port.write(buf, (err) => (err ? reject(err) : resolve())));
    await new Promise((resolve, reject) => this.port.drain((err) => (err ? reject(err) : resolve())));
  }

  /** Wait until `n` bytes are available or `timeoutMs` elapses; returns what arrived (may be short). */
  async readExact(n, timeoutMs) {
    const t0 = Date.now();
    while (this.rx.length < n && Date.now() - t0 < timeoutMs) await sleep(2);
    const take = Math.min(n, this.rx.length);
    const out = Buffer.from(this.rx.subarray(0, take));
    this.rx = this.rx.subarray(take);
    return out;
  }

  /** Collect everything that arrives during `ms` (plus anything already buffered). */
  async collect(ms) {
    await sleep(ms);
    const out = Buffer.from(this.rx);
    this.rx = Buffer.alloc(0);
    return out;
  }

  /** Bytes buffered but not yet consumed. */
  pending() {
    return this.rx.length;
  }
}

let shared = null;
/** The one serial connection used for the whole run (closed by lib/hooks.js). */
async function sharedSerial() {
  if (!shared) shared = new BootSerial();
  await shared.open();
  return shared;
}

async function closeShared() {
  if (shared) await shared.close();
  shared = null;
}

module.exports = { BootSerial, sharedSerial, closeShared, sleep };
