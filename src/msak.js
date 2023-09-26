import { discoverServerURLs } from './locate.js';

let bytesMap = {};

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

const runWorker = async function(streamid, globalStartTime, config, callbacks,
    urlPromise, filename, testType) {
    console.log(filename);
    // This makes the worker. The worker won't actually start until it
    // receives a message.
    const worker = new Worker(filename);

    let serverMeasurement;
    let clientMeasurement;
    
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


    // This is how the worker communicates back to the main thread of
    // execution.  The MsgTpe of `ev` determines which callback the message
    // gets forwarded to.
    worker.onmessage = function(ev) {
      if (!ev.data || !ev.data.MsgType || ev.data.MsgType === 'error') {
        clearTimeout(workerTimeout);
        worker.resolve(1);
        const msg = (!ev.data) ? `error` : ev.data.Error;
        callbacks.error(streamid, msg);
      } else if (ev.data.MsgType === 'start') {
        callbacks.start(streamid, ev.data.Data);
      } else if (ev.data.MsgType == 'measurement') {
        // For performance reasons, we parse the JSON outside of the thread
        // doing the downloading or uploading.
        if (ev.data.Source == 'server') {
          serverMeasurement = JSON.parse(ev.data.ServerMeasurement);
          callbacks.measurement({
            StreamID: streamid, 
            Source: ev.data.Source,
            Data: serverMeasurement,
          });
        } else {
          clientMeasurement = ev.data.ClientMeasurement;
          if (testType === 'download') {
            bytesMap[streamid] = clientMeasurement.Application.BytesReceived;
            let elapsed = performance.now() - globalStartTime;
            let sum = 0;
            Object.values(bytesMap).forEach(v => {
              sum += v;
            });

            let goodput = sum / ( elapsed * 1000 ) * 8;
            console.log(goodput);
          }
          callbacks.measurement({
            StreamID: streamid,
            Source: ev.data.Source,
            Data: clientMeasurement,
          });
        }
      } else if (ev.data.MsgType == 'close') {
        clearTimeout(workerTimeout);
        worker.resolve(0);
      }
    };
    
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

    let streams = 2;
    if (typeof config.streams !== 'undefined') {
      streams = config.streams;
    }

    console.log(streams);
    
    let globalStartTime = performance.now();

    for (let i = 0; i < streams; i++) {
      runWorker(i, globalStartTime, config, callbacks, urlPromise, workerfile, 'download');
    }
}

export async function test(config, userCallbacks) {
    const urlPromise = discoverServerURLs(config, userCallbacks);
    const downloadResult = await download(config, userCallbacks, urlPromise);
    return downloadResult;
}