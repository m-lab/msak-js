# msak-js
JavaScript client library for the [MSAK](https://github.com/m-lab/msak) multi-stream throughput measurement protocol.

## How to build
```bash
# Clone the repository
git clone https://github.com/m-lab/msak-js
cd msak-js

# Install dependencies
$ npm install

# Build the project
$ npm run build-prod
```

This will build the library and write the resulting UMD module in `dist/msak.js`

## How to use
Include `msak.js` in your HTML page:
```html
 <script src="msak.js" type="text/javascript"></script>
```

Create a new `msak.Client`, specifying your client name and version and providing your custom callbacks:

```js
let client = new msak.Client(CLIENTNAME, CLIENTVERSION, {
    onDownloadResult: (result) => {
        console.log(result);
    },
    onDownloadMeasurement: (measurement) => {
        console.log(measurement);
    },
    onUploadResult: (result) => {
        console.log(result);
    },
    onUploadMeasurement: (measurement) => {
        console.log(measurement);
    },
    onError: (err) => {
        console.log("error: " + err);
    }
});
```

For a complete example, see [index.html](index.html).
