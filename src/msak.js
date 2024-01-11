import { discoverServerURLs } from "./locate";
import * as consts from "./consts";

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
     */
    constructor(clientName, clientVersion) {
        if (!clientName || !clientVersion)
            throw new Error("client name and version are required");

        this.clientName = clientName;
        this.clientVersion = clientVersion;
        this.metadata = {};
        this._cc = consts.DEFAULT_CC;
        this._protocol = consts.DEFAULT_SCHEME;
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

        this.callbacks = {};
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
     * @param {number} value - The congestion control algorithm to use.
     * Must be one of the supported CC algorithms.
     */
    set cc(value) {
        console.log(value);
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
     * @param {URLSearchParams} sp - Starting URLSearchParams to modify (optional)
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

    // Public methods

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
            let res = this._locateCache.shift()

            let downloadURL = new URL(res.urls[this._protocol + '://' + consts.DOWNLOAD_PATH]);
            let uploadURL = new URL(res.urls[this._protocol + '://' + consts.UPLOAD_PATH]);

            downloadURL.search = this.#setSearchParams(downloadURL.searchParams)
            uploadURL.search = this.#setSearchParams(uploadURL.searchParams)

            return {
                "///throughput/v1/download": downloadURL,
                "///throughput/v1/upload": uploadURL
            };
        }

        // If this is the first call or the cache is empty, query the Locate service.
        if (this._locateCache.length == 0) {
            let results = await discoverServerURLs(this.clientName, this.clientVersion)
            this._locateCache = results;
            return makeURLs();
        } else {
            return makeURLs();
        }
    }

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
        this.download(serverURLs['//' + consts.DOWNLOAD_PATH]);
    }

    /**
     * @param {string} serverURL
     */
    download(serverURL) {
        let workerFile = this.downloadWorkerFile || new URL('download.js', import.meta.url);
        this.#debug('Starting ' + this._streams + ' download streams with URL '
            + serverURL.toString());
        for (let i = 0; i < this._streams; i++) {
            this.runWorker(workerFile, serverURL, i);
        }
    }

    #handleWorkerEvent(ev, id) {
        let message = ev.data
        if (message.type == 'connect') {
            if (!this._startTime) {
                this.#debug('setting global start time to ' + message.startTime);
                this._startTime = message.startTime;
            }
        }

        if (message.type == 'measurement' && message.client) {
            this._bytesReceivedPerStream[id] = message.client.Application.BytesReceived;

            let goodput = this._bytesReceivedPerStream[id] / (performance.now() - this._startTime) / 1000 * 8;
            let aggregateGoodput = this._bytesReceivedPerStream.reduce((a, b) => a + b, 0) /
                (performance.now() - this._startTime) / 1000 * 8;

            let elapsed = (performance.now() - this._startTime) / 1000;

            this.#debug('stream #' + id + ' elapsed ' + elapsed.toFixed(2)  + 's' +
                ' application r/w: ' +
                    message.client.Application.BytesReceived + '/' +
                    message.client.Application.BytesSent +
                ' stream goodput: ' + goodput.toFixed(2) + ' Mb/s' +
                ' aggr goodput: ' + aggregateGoodput.toFixed(2)  + ' Mb/s');

            this.callbacks.onMeasurement({
                elapsed: elapsed,
                stream: id,
                goodput: goodput,
            });

            this.callbacks.onResult({
                elapsed: elapsed,
                goodput: aggregateGoodput
            });
        }
    }

    async runWorker(workerfile, serverURL, streamID) {
        const worker = new Worker(workerfile);

        setTimeout(() => worker.terminate(), this._duration);
        worker.onmessage = (ev) => this.#handleWorkerEvent(ev, streamID);
        worker.postMessage(serverURL.toString());
    }
}
