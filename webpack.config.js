const webpack = require('webpack');
const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const config = {
  entry: './src/msak.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'msak.js',
    library: {
      type: 'umd',
      name: 'msak',
    },
    globalObject: 'this',
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/
      },
      {
        test: /(download|upload)\.js$/,
        use: 'babel-loader',
        exclude: /(node_modules)/,
        type: "asset/inline",
      },
    ]
  },
  plugins: [
    new CleanWebpackPlugin(),
  ]
};

module.exports = config;
