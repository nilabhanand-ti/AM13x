'use strict';
/**
 * Adapter so Mocha's built-in JSON reporter can write its file when it is run under
 * mocha-multi-reporters: that package hands reporters `{ reporterOptions }`, while
 * Mocha 11's JSON reporter only reads `options.reporterOption.output`.
 * The JSON format is Mocha's own, unchanged.
 */
const Mocha = require('mocha');

function JsonFileReporter(runner, options = {}) {
  const reporterOption = options.reporterOption || options.reporterOptions || {};
  return new Mocha.reporters.JSON(runner, { ...options, reporterOption });
}

module.exports = JsonFileReporter;
