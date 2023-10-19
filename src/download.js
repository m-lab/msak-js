const workerMain = function(ev) {
  const url = new URL(ev.data['///throughput/v1/download']);

  url.search += '&streams=1';
  url.search += '&duration=5000'
  console.log(url.search);
  const sock = new WebSocket(url, 'net.measurementlab.throughput.v1');

  let now;
  if (typeof performance !== 'undefined' &&
      typeof performance.now === 'function') {
    now = () => performance.now();
  } else {
    now = () => Date.now();
  }
  downloadTest(sock, postMessage, now);
};

const downloadTest = function(sock, postMessage, now) {
    sock.onclose = function() {
        postMessage({
            MsgType: 'close',
        });
    };

    sock.onerror = function(ev) {
        postMessage({
            MsgType: 'error',
            Error: ev.type,
        });
    };

    let start;
    let previous;
    let bytesReceived;

    sock.onopen = function() {
        start = now();
        previous = start;
        bytesReceived = 0;

        postMessage({
            MsgType: 'start',
            Data: {
                StartTime: start,
            },
        });
    };

    sock.onmessage = function(ev) {
        bytesReceived +=
            (typeof ev.data.size !== 'undefined') ? ev.data.size : ev.data.length;
        const t = now();
        const every = 250; // ms

        if (t - previous > every) {
            // Create a Measurement object.
            const measurement = {
                Application: {
                    BytesReceived: bytesReceived,
                    BytesSent: 0, // TODO
                },
                ElapsedTime: (t - start) * 1000,
            };

            sock.send(JSON.stringify(measurement));

            postMessage({
                MsgType: 'measurement',
                ClientMeasurement: measurement,
                Source: 'client',
            })
            previous = t;
        }

        // Pass along every server-side measurement.
        if (typeof ev.data === 'string') {
            postMessage({
                MsgType: 'measurement',
                ServerMeasurement: ev.data,
                Source: 'server',
            });
        }
    };
};

self.onmessage = workerMain;
