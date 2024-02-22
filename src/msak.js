import { discoverServerURLs } from "./locate";
import * as consts from "./consts";
import { cb, defaultErrCallback } from "./callbacks.js";
import { UAParser } from "ua-parser-js";

/**
 * Client is a client for the MSAK test protocol.
 */
export class Client {

    #debugEnabled = false;
    #cc = consts.DEFAULT_CC;
    #protocol = consts.DEFAULT_PROTOCOL;
    #streams = consts.DEFAULT_STREAMS;
    #duration = consts.DEFAULT_DURATION;
    #byteLimit = 0;

    #server = "";
    #startTime = undefined;
    #locateCache = [];

    /**
     * Application-level bytes received for each stream.
     * Streams are identifed by the array index.
     * @type {number[]}
     */
    #bytesReceivedPerStream = [];

    /**
     * Application-level bytes sent for each stream.
     * Streams are identifed by the array index.
     * @type {number[]}
     */
    #bytesSentPerStream = [];

    /**
     * Last TCPInfo object received for each stream.
     * Streams are identifed by the array index.
     * @type {Object[]}
     */
    #lastTCPInfoPerStream = [];

    /**
     *
     * Client is a client for the MSAK test protocol. Client name and version
     * are mandatory and passed to the server as metadata.
     *
     * @param {string} clientName - A unique name for this client.
     * @param {string} clientVersion - The client's version.
     * @param {Object} [userCallbacks] - An object containing user-defined callbacks.
     */
    constructor(clientName, clientVersion, userCallbacks) {
        if (!clientName || !clientVersion)
            throw new Error("client name and version are required");

        this.downloadWorkerFile = undefined;
        this.uploadWorkerFile = undefined;
        this.clientName = clientName;
        this.clientVersion = clientVersion;
        this.callbacks = userCallbacks;
        this.metadata = {};
    }

    //
    // Setters
    //

    /**
     * @param {boolean} value - Whether to print debug messages to the console.
     */
    set debug(value) {
        this.#debugEnabled = value;
    }

    /**
     * @param {number} value - The number of streams to use.
     * Must be between 1 and 4.
     */
    set streams(value) {
        if (value <= 0 || value > 4) {
            throw new Error("number of streams must be between 1 and 4");
        }
        this.#streams = value;
    }

    /**
     * @param {string} value - The congestion control algorithm to use.
     * Must be one of the supported CC algorithms.
     */
    set cc(value) {
        if (!consts.SUPPORTED_CC_ALGORITHMS.includes(value)) {
            throw new Error("supported algorithm are " + consts.SUPPORTED_CC_ALGORITHMS);
        }
        this.#cc = value;
    }

    /**
     * @param {string} value - The protocol to use. Must be 'ws' or 'wss'.
     */
    set protocol(value) {
        if (value !== 'ws' && value !== 'wss') {
            throw new Error("protocol must be 'ws' or 'wss'");
        }
        this.#protocol = value;
    }

    /**
    * @param {number} value - The duration of the test in milliseconds.
    */
    set duration(value) {
        if (value <= 0 || value > 20000) {
            throw new Error("duration must be between 1 and 20000");
        }
        this.#duration = value;
    }

    /**
     * @param {number} value - The maximum number of bytes to send/receive.
     */
    set bytes(value) {
        if (value < 0) {
            throw new Error("bytes must be greater than 0");
        }
        this.#byteLimit = value;
    }

    //
    // Private methods
    //

    /**
     *
     * @param {Object} obj - The object to print to the console.
     */
    #debug(obj) {
        if (this.#debugEnabled) console.log(obj);
    }

    /**
     * Sets standard client metadata, protocol options and custom metadata on
     * the provided URLSearchParams. If a URLSearchParams is not provided, a new
     * one is created.
     *
     * @param {URLSearchParams} [sp] - Starting URLSearchParams to modify (optional)
     * @returns {URLSearchParams} The complete URLSearchParams
     */
    #setSearchParams(sp) {
        if (!sp) {
            sp = new URLSearchParams();
        }
        // Set standard client_ metadata.
        sp.set("client_name", this.clientName);
        sp.set("client_version", this.clientVersion);
        sp.set("client_library_name", consts.LIBRARY_NAME);
        sp.set("client_library_version", consts.LIBRARY_VERSION);

        // Extract metadata from the UA.
        const parser = new UAParser(navigator.userAgent);
        if (parser.getBrowser().name)
            sp.set("client_browser", parser.getBrowser().name.toLowerCase());
        if (parser.getOS().name)
            sp.set("client_os", parser.getOS().name.toLowerCase());
        if (parser.getDevice().type)
            sp.set("client_device", parser.getDevice().type.toLowerCase());
        if (parser.getCPU().architecture)
            sp.set("client_arch", parser.getCPU().architecture.toLowerCase());

        // Set protocol options.
        sp.set("streams", this.#streams.toString());
        sp.set("cc", this.#cc);
        sp.set('duration', this.#duration.toString());
        sp.set("bytes", this.#byteLimit.toString());

        // Set additional custom metadata.
        if (this.metadata) {
            for (const [key, value] of Object.entries(this.metadata)) {
                sp.set(key, value);
            }
        }
        return sp;
    }

    #makeURLPairForServer(server) {
        const downloadURL = new URL(this.#protocol + "://" + server + consts.DOWNLOAD_PATH);
        const uploadURL = new URL(this.#protocol + "://" + server + consts.UPLOAD_PATH);

        let sp = this.#setSearchParams()
        downloadURL.search = sp.toString();
        uploadURL.search = sp.toString();

        // Set protocol.
        downloadURL.protocol = this.#protocol;
        uploadURL.protocol = this.#protocol;

        return {
            "///throughput/v1/download": downloadURL.toString(),
            "///throughput/v1/upload": uploadURL.toString()
        };
    }

    #handleWorkerEvent(ev, testType, id, worker) {
        let message = ev.data
        if (message.type == 'connect') {
            if (!this.#startTime) {
                this.#startTime = performance.now();
                this.#debug('setting global start time to ' + performance.now());
            }
        }

        if (message.type == 'error') {
            this.#debug('error: ' + message.error);
            this.callbacks.onError(message.error);
            worker.reject(message.error);
        }

        if (message.type == 'close') {
            this.#debug('stream #' + id + ' closed');
            worker.resolve(0);
        }

        if (message.type == 'measurement') {
            let measurement;
            let source = "";
            let parsedMeasurement;

            // If this is a server-side measurement, read data from TCPInfo
            // regardless of the test direction.
            if (message.server) {
                // Keep the parsed measurement aside to avoid calling JSON.parse
                // twice in case this is an upload.
                parsedMeasurement = JSON.parse(message.server);

                if (parsedMeasurement.TCPInfo) {
                    this.#lastTCPInfoPerStream[id] = parsedMeasurement.TCPInfo;
                }
            }

            switch (testType) {
                case 'download':
                    if (message.client) {
                        source = 'client';
                        measurement = message.client;
                    }
                    break;
                case 'upload':
                    if (message.server) {
                        source = 'server';
                        measurement = parsedMeasurement;
                    }
                    break;
                default:
                    throw new Error('unknown test type: ' + testType);
            }

            if (measurement) {
                this.#bytesReceivedPerStream[id] = measurement.Application.BytesReceived || 0;
                this.#bytesSentPerStream[id] = measurement.Application.BytesSent || 0;

                const elapsed = (performance.now() - this.#startTime) / 1000;
                const goodput = this.#bytesReceivedPerStream[id] / measurement.ElapsedTime * 8;
                const aggregateGoodput = this.#bytesReceivedPerStream.reduce((a, b) => a + b, 0) /
                    elapsed / 1e6 * 8;

                // Compute the average retransmission of all streams.
                let avgRetrans = 0;
                if (this.#lastTCPInfoPerStream.length > 0) {
                    avgRetrans = this.#lastTCPInfoPerStream.reduce((a, b) => a + b.BytesRetrans, 0) /
                        this.#lastTCPInfoPerStream.reduce((a, b) => a + b.BytesSent, 0);
                }

                this.#debug('stream #' + id + ' elapsed ' + (measurement.ElapsedTime / 1e6).toFixed(2) + 's' +
                    ' application r/w: ' +
                    this.#bytesReceivedPerStream[id] + '/' +
                    this.#bytesSentPerStream[id] + ' bytes' +
                    ' stream goodput: ' + goodput.toFixed(2) + ' Mb/s' +
                    ' aggr goodput: ' + aggregateGoodput.toFixed(2) + ' Mb/s' +
                    ' stream minRTT: ' + (this.#lastTCPInfoPerStream[id] !== undefined ?
                            this.#lastTCPInfoPerStream[id].MinRTT : "n/a") +
                    ' retrans: ' + (this.#lastTCPInfoPerStream[id] !== undefined ?
                            this.#lastTCPInfoPerStream[id].BytesRetrans /
                            this.#lastTCPInfoPerStream[id].BytesSent : "n/a") +
                    ' avg retrans: ' + avgRetrans);

                this.callbacks.onMeasurement({
                    elapsed: elapsed,
                    stream: id,
                    goodput: goodput,
                    measurement: measurement,
                    source: source,
                });

                this.callbacks.onResult({
                    elapsed: elapsed,
                    goodput: aggregateGoodput,
                    retransmission: avgRetrans,
                    minRTT: Math.min(this.#lastTCPInfoPerStream.map(x => x.MinRTT)),
                });
            }
        }
    }

    /**
     * Retrieves the next download/upload URL pair from the Locate service. On
     * the first invocation, it requests new URLs for nearby servers from the
     * Locate service. On subsequent invocations, it returns the next cached
     * result.
     *
     * All the returned URLs include protocol options and metadata in the
     * querystring.
     * @returns A map of two URLs - one for download, one for upload.
     */
    async #nextURLsFromLocate() {
        /**
         * Returns URLs for the download and upload endpoints including all
         * querystring parameters.
         * @returns {Object}  A map of URLs for the download and upload.
         */
        let makeURLs = () => {
            const res = this.#locateCache.shift()

            const downloadURL = new URL(res.urls[this.#protocol + '://' + consts.DOWNLOAD_PATH]);
            const uploadURL = new URL(res.urls[this.#protocol + '://' + consts.UPLOAD_PATH]);

            downloadURL.search = this.#setSearchParams(downloadURL.searchParams);
            uploadURL.search = this.#setSearchParams(uploadURL.searchParams);

            return {
                "///throughput/v1/download": downloadURL,
                "///throughput/v1/upload": uploadURL
            };
        }

        // If this is the first call or the cache is empty, query the Locate service.
        if (this.#locateCache.length == 0) {
            const results = await discoverServerURLs(this.clientName, this.clientVersion)
            this.#locateCache = results;
            return makeURLs();
        } else {
            return makeURLs();
        }
    }

    // Public methods

    /**
     *
     * @param {string} [server] - The server to connect to.  If not specified,
     * will query the Locate service to get a nearby server.
     */
    async start(server) {
        let serverURLs;
        if (server) {
            serverURLs = this.#makeURLPairForServer(server);
        } else {
            serverURLs = await this.#nextURLsFromLocate();
        }
        await this.download(serverURLs['//' + consts.DOWNLOAD_PATH]);
        await this.upload(serverURLs['//' + consts.UPLOAD_PATH]);
    }

    /**
     * @param {string} serverURL
     */
    async download(serverURL) {
        let workerFile = this.downloadWorkerFile || new URL('download.js', import.meta.url);
        this.#debug('Starting ' + this.#streams + ' download streams with URL '
            + serverURL.toString());

        // Set callbacks.
        this.callbacks = {
            ...this.callbacks,
            onResult: cb('onDownloadResult', this.callbacks),
            onMeasurement: cb('onDownloadMeasurement', this.callbacks),
            onError: cb('onError', this.callbacks, defaultErrCallback),
        }

        // Reset byte counters and start time.
        this.#bytesReceivedPerStream = [];
        this.#bytesSentPerStream = [];
        this.#lastTCPInfoPerStream = [];
        this.#startTime = undefined;

        let workerPromises = [];
        for (let i = 0; i < this.#streams; i++) {
            workerPromises.push(this.runWorker('download', workerFile, serverURL, i));
        }
        await Promise.all(workerPromises);
    }

    async upload(serverURL) {
        let workerFile = this.uploadWorkerFile || new URL('upload.js', import.meta.url);
        this.#debug('Starting ' + this.#streams + ' upload streams with URL '
            + serverURL.toString());

        // Set callbacks.
        this.callbacks = {
            ...this.callbacks,
            onResult: cb('onUploadResult', this.callbacks),
            onMeasurement: cb('onUploadMeasurement', this.callbacks),
            onError: cb('onError', this.callbacks, defaultErrCallback),
        }

        // Reset byte counters and start time.
        this.#bytesReceivedPerStream = [];
        this.#bytesSentPerStream = [];
        this.#startTime = undefined;

        let workerPromises = [];
        for (let i = 0; i < this.#streams; i++) {
            workerPromises.push(this.runWorker('upload', workerFile, serverURL, i));
        }
        await Promise.all(workerPromises);
    }

    runWorker(testType, workerfile, serverURL, streamID) {
        const worker = new Worker(workerfile);

        // Create a Promise that will be resolved when the worker terminates
        // successfully and rejected when the worker terminates with an error.
        const workerPromise = new Promise((resolve, reject) => {
            worker.resolve = (returnCode) => {
                worker.terminate();
                resolve(returnCode);
            };
            worker.reject = (error) => {
                worker.terminate();
                reject(error);
            };
        });

        // If the server did not close the connection already by then, terminate
        // the worker and resolve the promise after the expected duration + 1s.
        setTimeout(() => worker.resolve(0), this.#duration + 1000);


        worker.onmessage = (ev) => {
            this.#handleWorkerEvent(ev, testType, streamID, worker);
        };
        worker.postMessage({
            url: serverURL.toString(),
            bytes: this.#byteLimit
        });

        return workerPromise;
    }
}
