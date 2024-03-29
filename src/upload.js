const MAX_MESSAGE_SIZE = 8388608; /* = (1<<23) = 8MB */
const MEASUREMENT_INTERVAL = 250; // ms
const SCALING_FRACTION = 16;

const workerMain = function (ev) {

    // Establish WebSocket connection to the URL passed by the caller.
    const url = new URL(ev.data.url);
    const byteLimit = ev.data.bytes || 0;

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
    uploadTest(sock, byteLimit, now);
};

const uploadTest = function (sock, byteLimit, now) {
    let closed = false;
    let bytesReceived;
    let bytesSent;

    sock.onclose = function () {
        if (!closed) {
            closed = true;
            postMessage({
                type: 'close',
            });
        }
    };

    sock.onerror = function (ev) {
        postMessage({
            type: 'error',
            error: ev.type,
        });
    };

    // onmessage calls the measurement callback for every counterflow
    // message received from the server during the upload measurement.
    sock.onmessage = function (ev) {
        if (typeof ev.data !== 'undefined') {
            bytesReceived +=
                (typeof ev.data.size !== 'undefined') ? ev.data.size : ev.data.length;
            postMessage({
                type: 'measurement',
                server: ev.data,
            });
        }
    };

    sock.onopen = function () {
        bytesReceived = 0;
        bytesSent = 0;

        const initialMessageSize = 8192; /* (1<<13) = 8kBytes */
        const data = new Uint8Array(initialMessageSize);
        const start = now(); // ms since epoch
        const duration = 10000; // ms
        const end = start + duration; // ms since epoch

        postMessage({
            type: 'connect',
            startTime: start,
        });

        // Start the upload loop.
        uploader(data, start, end, start, 0);
    };

    /**
     * uploader is the main loop that uploads data in the web browser. It must
     * carefully balance a bunch of factors:
     *   1) message size determines measurement granularity on the client side,
     *   2) the JS event loop can only fire off so many times per second, and
     *   3) websocket buffer tracking seems inconsistent between browsers.
     *
     * Because of (1), we need to have small messages on slow connections, or
     * else this will not accurately measure slow connections. Because of (2), if
     * we use small messages on fast connections, then we will not fill the link.
     * Because of (3), we can't depend on the websocket buffer to "fill up" in a
     * reasonable amount of time.
     *
     * So on fast connections we need a big message size (once the message has
     * been handed off to the browser, it runs on the browser's fast compiled
     * internals) and on slow connections we need a small message. Because this
     * is used as a speed test, we don't know before the test which strategy we
     * will be using, because we don't know the speed before we test it.
     * Therefore, we use a strategy where we grow the message exponentially over
     * time. In an effort to be kind to the memory allocator, we always double
     * the message size instead of growing it by e.g. 1.3x.
     *
     * @param {Uint8Array} data
     * @param {*} start
     * @param {*} end
     * @param {*} previous
     */
    function uploader(data, start, end, previous) {
        if (closed) {
            // socket.send() with too much buffering causes socket.close(). We only
            // observed this behaviour with pre-Chromium Edge.
            return;
        }
        const t = now();
        if (t >= end) {
            sock.close();
            // send one last measurement.
            // TODO
            return;
        }

        // Check if we are over the limit and, if so, stop the uploader loop.
        // The server is going to close the connection after the byte limit has
        // been reached or the duration timeout has expired. Meanwhile, the client
        // keeps running and handling WebSocket events.
        if (byteLimit > 0 && bytesSent >= byteLimit) {
            return;
        }

        // We keep 7 messages in the send buffer, so there is always some more
        // data to send. The maximum buffer size is 8 * 8MB - 1 byte ~= 64M.
        const desiredBuffer = 7 * data.length;
        if (sock.bufferedAmount < desiredBuffer) {
            sock.send(data);
            bytesSent += data.length;
        }

        // Message size is doubled after the first 16 messages, and subsequently
        // every 8, up to maxMessageSize.
        const origSize = data.length;

        if (origSize >= MAX_MESSAGE_SIZE || origSize > bytesSent / SCALING_FRACTION) {
            size = scaleMessage(origSize);
        } else {
            console.log("Increasing message size to " + origSize * 2 + " bytes");
            size = scaleMessage(origSize * 2);
        }

        if (size != origSize) {
            data = new Uint8Array(size);
        }

        if (t >= previous + MEASUREMENT_INTERVAL) {
            // Create a Measurement object.
            const measurement = {
                Application: {
                    BytesReceived: bytesReceived,
                    BytesSent: bytesSent,
                },
                ElapsedTime: (t - start) * 1000,
            };

            const measurementStr = JSON.stringify(measurement);
            sock.send(measurementStr);
            bytesSent += measurementStr.length;

            postMessage({
                type: 'measurement',
                client: measurement,
            });
            previous = t;
        }

        // Loop the uploader function in a way that respects the JS event handler.
        setTimeout(() => uploader(data, start, end, previous), 0);
    }

    function scaleMessage(msgSize) {
        // Check if the next payload size will push the total number of bytes over the limit.
        const excess = bytesSent + msgSize - byteLimit;
        if (byteLimit > 0 && excess > 0) {
            msgSize -= excess;
        }
        return msgSize;
    }
};

self.onmessage = workerMain;
