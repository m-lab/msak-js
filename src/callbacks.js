// cb creates a default-empty callback function, allowing library users to
// only need to specify callback functions for the events they care about.
export const cb = function (name, callbacks, defaultFn) {
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
export const defaultErrCallback = function (err) {
    throw new Error(err);
};
