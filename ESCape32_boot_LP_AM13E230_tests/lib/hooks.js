'use strict';
/**
 * Mocha root hooks: release the shared resources once the whole run is over.
 * (Every case in this plan uses `jtag`, so the scripting session is held for the run.)
 */
const dbg = require('./debug');
const { closeShared } = require('./serial');

exports.mochaHooks = {
  async afterAll() {
    try {
      await closeShared();
    } finally {
      dbg.shutdown();
    }
  },
};
