import SimpleLogger from 'simple-node-logger';
const log = SimpleLogger.createSimpleLogger('widdix.log'); // TODO replace with something that can be flushed finally
import { serializeError } from 'serialize-error';

function wrapper(level) {
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
}

export function setLevel (level) {
  log.setLevel(level);
}

export const trace = wrapper('trace');

export const debug = wrapper('debug');

export const info = wrapper('info');

export const warning = wrapper('warn');

export const error = wrapper('error');

export const fatal = wrapper('fatal');
