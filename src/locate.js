import { LOCATE_BASE_URL, LOCATE_RESOURCE_PATH, LIBRARY_NAME, LIBRARY_VERSION } from "./consts";

/**
 * discoverServerURLs contacts a web service (likely the Measurement Lab
 * locate service, but not necessarily) and gets URLs with access tokens in
 * them for the client.
 *
 * @param {string} clientName - The name of the client.
 * @param {string} clientVersion - The client version.
 * @param {string} [lbBaseURL] - The base URL of the load balancer. (optional)
 *
 * It uses the callback functions `error`, `serverDiscovery`, and
 * `serverChosen`.
 *
 * @name discoverServerURLs
 * @public
 */
export async function discoverServerURLs(clientName, clientVersion, lbBaseURL) {
    if (!lbBaseURL) {
        lbBaseURL = LOCATE_BASE_URL
    }
    const lbURL = new URL(lbBaseURL + LOCATE_RESOURCE_PATH);

    // Pass client/library name and versions to the load balancer in the
    // querystring.
    const params = new URLSearchParams();
    params.set('client_name', clientName);
    params.set('client_version', clientVersion);
    params.set("client_library_name", LIBRARY_NAME);
    params.set('client_library_version', LIBRARY_VERSION)

    lbURL.search = params.toString();

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

    console.log(js.results);

    return js.results;
}
