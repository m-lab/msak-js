const workerMain = function (ev) {

    // Establish WebSocket connection to the URL passed by the caller.
    const url = new URL(ev.data.url);
    const byteLimit = ev.data.bytes;

    console.log("Connecting to " + url);
    const sock = new WebSocket(url, 'net.measurementlab.throughput.v1');
    console.log("Connection established");

    // Define now() as either performance.now() or Date.now(). This allows to
    // support browsers that do not support performance.now() (e.g. IE11).
    let now;
    if (typeof performance !== 'undefined' &&
        typeof performance.now === 'function') {
        // The ~~ operator is a faster way of doing Math.floor().
        now = () => ~~performance.now();
    } else {
        now = () => Date.now();
    }
    downloadTest(sock, byteLimit, now);
};

const downloadTest = function(sock, byteLimit, now) {

    let start;
    let previous;
    let bytesReceived;
    let bytesSent;

    sock.onclose = function() {
        // Create and post one last measurement object to the main thread.
        const t = now();
        const measurement = {
            Application: {
                BytesReceived: bytesReceived,
                BytesSent: bytesSent,
            },
            ElapsedTime: (t - start) * 1000,
        };
        postMessage({
            type: 'measurement',
            client: measurement,
        });
        postMessage({
            type: 'close',
        });
    };

    sock.onerror = function(ev) {
        postMessage({
            type: 'error',
            error: ev.type,
        });
    };

    sock.onopen = function() {
        start = now();
        previous = start;
        bytesReceived = 0;
        bytesSent = 0;

        postMessage({
            type: 'connect',
            startTime: start,
        });
    };

    sock.onmessage = function(ev) {
        bytesReceived +=
            (typeof ev.data.size !== 'undefined') ? ev.data.size : ev.data.length;

        const t = now();
        const every = 200; // ms

        if (t - previous > every) {
            // Create a Measurement object.
            const measurement = {
                Application: {
                    BytesReceived: bytesReceived,
                    BytesSent: bytesSent, // TODO
                },
                ElapsedTime: (t - start) * 1000,
            };

            const measurementStr = JSON.stringify(measurement);
            sock.send(measurementStr);
            bytesSent += measurementStr.length;

            postMessage({
                type: 'measurement',
                client: measurement,
            })
            previous = t;
        }

        // Pass along every server-side measurement.
        if (typeof ev.data === 'string') {
            postMessage({
                type: 'measurement',
                server: ev.data,
            });
        }
    };
};

self.onmessage = workerMain;
