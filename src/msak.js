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

const runWorker = async function(config, callbacks, urlPromise, filename) {
    console.log(filename);
      // This makes the worker. The worker won't actually start until it
    // receives a message.
    const worker = new Worker(filename);
    
    worker.resolve = function (returnCode) {
        if (returnCode == 0) {
            callbacks.complete();
        }
        worker.terminate();
    }

    // If the worker takes 12 seconds, kill it and return an error code.
    // Most clients take longer than 10 seconds to complete the upload and
    // finish sending the buffer's content, sometimes hitting the socket's
    // timeout of 15 seconds. This makes sure uploads terminate on time and
    // get a chance to send one last measurement after 10s.
    const workerTimeout = setTimeout(() => worker.resolve(0), 12000);
    
    // We can't start the worker until we know the right server, so we wait
    // here to find that out.
    const urls = await urlPromise.catch((err) => {
        // Clear timer, terminate the worker and rethrow the error.
        clearTimeout(workerTimeout);
        worker.resolve(2);
        throw err;
    });

    // Start the worker.
    worker.postMessage(urls);
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