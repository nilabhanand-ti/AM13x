'use strict';
// Mocha configuration for the ESCape32 bootloader hardware suite.
// Cases run in plan order (t01 ... t13) and depend on the target state left by
// earlier cases, so files are sorted and never run in parallel.
module.exports = {
  spec: ['specs/*.spec.js'],
  sort: true,
  parallel: false,
  require: ['lib/hooks.js'],
  timeout: 600000, // the first case includes a headless build + flash
  slow: 30000,
  exit: true, // the scripting worker / serial port must not keep the process alive
  reporter: 'mocha-multi-reporters',
  'reporter-option': ['configFile=.mocha-multi-reporters.json'],
};
