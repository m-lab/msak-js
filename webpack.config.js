const webpack = require('webpack');
const path = require('path');
const TerserPlugin = require("terser-webpack-plugin");
const { CleanWebpackPlugin } = require('clean-webpack-plugin');


const config = {
  entry: {
    'msak.js': './src/msak.js',
    'msak.min.js': './src/msak.js',
  },
  output: {
    // Each entry corresponds to an output file under dist/
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]',
    library: {
      type: 'umd',
      name: 'msak',
    },
    globalObject: 'this',
  },
  devtool: 'source-map',
  optimization: {
    minimize: true,
    minimizer: [
      // Only minify entries ending in .min.js. This allows to have both the
      // minified and non-minified versions under dist/.
      new TerserPlugin({
        include: /\.min\.js$/
      })
    ]
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(),
  ]
};

module.exports = config;
