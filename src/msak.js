import { discoverServerURLs } from "./locate";
import * as consts from "./consts";
import { cb, defaultErrCallback } from "./callbacks.js";

/**
 * Client is a client for the MSAK test protocol.
 */
export class Client {
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

        this._cc = consts.DEFAULT_CC;
        this._protocol = consts.DEFAULT_PROTOCOL;
        this._streams = consts.DEFAULT_STREAMS;
        this._duration = consts.DEFAULT_DURATION;
        this._server = "";

        this._startTime = undefined;
        this._locateCache = [];

        /**
         * Bytes received for each stream.
         * Streams are identifed by the array index.
         * @type {Array}
         * @public
         */
        this._bytesReceivedPerStream = [];

        /**
         * Bytes sent for each stream.
         * Streams are identifed by the array index.
         * @type {Array}
         * @public
         */
        this._bytesSentPerStream = [];
    }

    //
    // Setters
    //

    /**
     * @param {boolean} value - Whether to print debug messages to the console.
     */
    set debug(value) {
        this._debug = value;
    }

    /**
     * @param {number} value - The number of streams to use.
     * Must be between 1 and 4.
     */
    set streams(value) {
        if (value <= 0 || value > 4) {
            throw new Error("number of streams must be between 1 and 4");
        }
        this._streams = value;
    }

    /**
     * @param {string} value - The congestion control algorithm to use.
     * Must be one of the supported CC algorithms.
     */
    set cc(value) {
        if (!consts.SUPPORTED_CC_ALGORITHMS.includes(value)) {
            throw new Error("supported algorithm are " + consts.SUPPORTED_CC_ALGORITHMS);
        }
        this._cc = value;
    }

    /**
     * @param {string} value - The protocol to use. Must be 'ws' or 'wss'.
     */
    set protocol(value) {
        if (value !== 'ws' && value !== 'wss') {
            throw new Error("protocol must be 'ws' or 'wss'");
        }
        this._protocol = value;
    }

     /**
     * @param {number} value - The duration of the test in milliseconds.
     */
     set duration(value) {
        if (value <= 0 || value > 20000) {
            throw new Error("duration must be between 1 and 20000");
        }
        this._duration = value;
    }

    //
    // Private methods
    //

    /**
     *
     * @param {Object} obj - The object to print to the console.
     */
    #debug(obj) {
        if (this._debug) console.log(obj);
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

        // Set protocol options.
        sp.set("streams", this._streams.toString());
        sp.set("cc", this._cc);
        sp.set('duration', this._duration.toString());

        // Set additional custom metadata.
        if (this.metadata) {
            for (const [key, value] of Object.entries(this.metadata)) {
                sp.set(key, value);
            }
        }
        return sp;
    }

    #makeURLPairForServer(server) {
        const downloadURL = new URL(this._protocol + "://" + server + consts.DOWNLOAD_PATH);
        const uploadURL = new URL(this._protocol + "://" + server + consts.UPLOAD_PATH);

        let sp = this.#setSearchParams()
        downloadURL.search = sp.toString();
        uploadURL.search = sp.toString();

        // Set protocol.
        downloadURL.protocol = this._protocol;
        uploadURL.protocol = this._protocol;

        return {
            "///throughput/v1/download": downloadURL.toString(),
            "///throughput/v1/upload": uploadURL.toString()
        };
    }

    #handleWorkerEvent(ev, testType, id, worker) {
        let message = ev.data
        if (message.type == 'connect') {
            if (!this._startTime) {
                this._startTime = performance.now();
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
            switch (testType) {
                case 'download':
                    if (message.client) {
                        measurement = message.client;
                    }
                    break;
                case 'upload':
                    if (message.server) {
                        measurement = JSON.parse(message.server);
                    }
                    break;
                default:
                    throw new Error('unknown test type: ' + testType);
            }

            if (measurement) {
                this._bytesReceivedPerStream[id] = measurement.Application.BytesReceived;

                const elapsed = (performance.now() - this._startTime) / 1000;
                const goodput = this._bytesReceivedPerStream[id] / measurement.ElapsedTime * 8;
                const aggregateGoodput = this._bytesReceivedPerStream.reduce((a, b) => a + b, 0) /
                    elapsed / 1e6 * 8;

                this.#debug('stream #' + id + ' elapsed ' + (measurement.ElapsedTime / 1e6).toFixed(2) + 's' +
                    ' application r/w: ' +
                    measurement.Application.BytesReceived + '/' +
                    measurement.Application.BytesSent +
                    ' stream goodput: ' + goodput.toFixed(2) + ' Mb/s' +
                    ' aggr goodput: ' + aggregateGoodput.toFixed(2) + ' Mb/s');

                this.callbacks.onMeasurement({
                    elapsed: elapsed,
                    stream: id,
                    goodput: goodput,
                    measurement: measurement,
                    source: 'client',
                });

                this.callbacks.onResult({
                    elapsed: elapsed,
                    goodput: aggregateGoodput
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
            const res = this._locateCache.shift()

            const downloadURL = new URL(res.urls[this._protocol + '://' + consts.DOWNLOAD_PATH]);
            const uploadURL = new URL(res.urls[this._protocol + '://' + consts.UPLOAD_PATH]);

            downloadURL.search = this.#setSearchParams(downloadURL.searchParams);
            uploadURL.search = this.#setSearchParams(uploadURL.searchParams);

            return {
                "///throughput/v1/download": downloadURL,
                "///throughput/v1/upload": uploadURL
            };
        }

        // If this is the first call or the cache is empty, query the Locate service.
        if (this._locateCache.length == 0) {
            const results = await discoverServerURLs(this.clientName, this.clientVersion)
            this._locateCache = results;
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
        this.#debug('Starting ' + this._streams + ' download streams with URL '
            + serverURL.toString());

        // Set callbacks.
        this.callbacks = {
            ...this.callbacks,
            onResult: cb('onDownloadResult', this.callbacks),
            onMeasurement: cb('onDownloadMeasurement', this.callbacks),
            onError: cb('onError', this.callbacks, defaultErrCallback),
        }

        // Reset byte counters and start time.
        this._bytesReceivedPerStream = [];
        this._bytesSentPerStream = [];
        this._startTime = undefined;

        let workerPromises = [];
        for (let i = 0; i < this._streams; i++) {
            workerPromises.push(this.runWorker('download', workerFile, serverURL, i));
        }
        await Promise.all(workerPromises);
    }

    async upload(serverURL) {
        let workerFile = this.uploadWorkerFile || new URL('upload.js', import.meta.url);
        this.#debug('Starting ' + this._streams + ' upload streams with URL '
            + serverURL.toString());

        // Set callbacks.
        this.callbacks = {
            ...this.callbacks,
            onResult: cb('onUploadResult', this.callbacks),
            onMeasurement: cb('onUploadMeasurement', this.callbacks),
            onError: cb('onError', this.callbacks, defaultErrCallback),
        }

        // Reset byte counters and start time.
        this._bytesReceivedPerStream = [];
        this._bytesSentPerStream = [];
        this._startTime = undefined;

        let workerPromises = [];
        for (let i = 0; i < this._streams; i++) {
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
        setTimeout(() => worker.resolve(0), this._duration + 1000);


        worker.onmessage = (ev) => {
            this.#handleWorkerEvent(ev, testType, streamID, worker);
        };
        worker.postMessage(serverURL.toString());

        return workerPromise;
    }
}
