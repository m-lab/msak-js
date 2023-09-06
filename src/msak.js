import { discoverServerURLs } from './locate.js';

// cb creates a default-empty callback function, allowing library users to
// only need to specify callback functions for the events they care about.
//
// This function is not exported.
const cb = function (name, callbacks, defaultFn) {
  if (typeof (callbacks) !== 'undefined' && name in callbacks) {
    return callbacks[name];
  } else if (typeof defaultFn !== 'undefined') {
    return defaultFn;
  } else {
    // If no default function is provided, use the empty function.
    return function () { };
  }
};

// The default response to an error is to throw an exception.
const defaultErrCallback = function (err) {
  throw new Error(err);
};

const runWorker = async function(config, callbacks, urlPromise, filename, type) {
    console.log(filename);
}

export async function download(config, userCallbacks, urlPromise) {
    const callbacks = {
        error: cb('error', userCallbacks, defaultErrCallback),
        start: cb('downloadStart', userCallbacks),
        measurement: cb('downloadMeasurement', userCallbacks),
        complete: cb('downloadComplete', userCallbacks),
    }
    const workerfile = config.downloadWorkerFile || new URL('download.js', import.meta.url);
    runWorker(config, callbacks, urlPromise, workerfile, 'download');
}

export async function test(config, userCallbacks) {
    const urlPromise = discoverServerURLs(config, userCallbacks);
    const downloadResult = await download(config, userCallbacks, urlPromise);
    return downloadResult;
}