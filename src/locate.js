/**
 * discoverServerURLs contacts a web service (likely the Measurement Lab
 * locate service, but not necessarily) and gets URLs with access tokens in
 * them for the client. 
 *
 * @param {Object} config - An associative array of configuration options.
 *
 * It uses the callback functions `error`, `serverDiscovery`, and
 * `serverChosen`.
 *
 * @name discoverServerURLs
 * @public
 */
export async function discoverServerURLs(config) {
    let protocol = "wss";

    const metadata = new URLSearchParams(config.metadata);

    const lbURL = (config && ("loadbalancer" in config)) ? config.loadbalancer : new URL("https://locate.measurementlab.net/v2/nearest/msak/throughput1");
    lbURL.search = metadata;

    const response = await fetch(lbURL).catch((err) => {
        throw new Error(err);
    });
    const js = await response.json();
    if (!("results" in js)) {
        console.log(`Could not understand response from ${lbURL}: ${js}`);
        return {};
    }

    // TODO: do not discard unused results. If the first server is unavailable
    // the client should quickly try the next server.
    //
    // Choose the first result sent by the load balancer. This ensures that
    // in cases where we have a single pod in a metro, that pod is used to
    // run the measurement. When there are multiple pods in the same metro,
    // they are randomized by the load balancer already.
    const choice = js.results[0];
    console.log("Server chosen: ");
    console.log(choice);

    return {
        "///throughput/v1/download": choice.urls[protocol + ":///throughput/v1/download"],
        "///throughput/v1/upload": choice.urls[protocol + ":///throughput/v1/upload"],
    };
}