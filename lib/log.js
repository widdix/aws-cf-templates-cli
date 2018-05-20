'use strict';

const log = require('simple-node-logger').createSimpleFileLogger('widdix.log');
const serializeError = require('serialize-error');

const wrapper = (level) => {
  return (message, data) => {
    if (data !== undefined) {
      if (data instanceof Error) {
        log[level](message, serializeError(data));
      } else {
        log[level](message, JSON.stringify(data));
      }
    } else {
      log[level](message);
    }
  };
};

module.exports.trace = wrapper('trace');

module.exports.debug = wrapper('debug');

module.exports.info = wrapper('info');

module.exports.warning = wrapper('warn');

module.exports.error = wrapper('error');

module.exports.fatal = wrapper('fatal');
