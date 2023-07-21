const webpack = require("webpack")

const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
// const nodeExternals = require('webpack-node-externals');

module.exports = function override(config, env) {
  //do stuff with the webpack config...
  // config.externals = [nodeExternals()];

  config.resolve.fallback = {
    ...config.resolve.fallback,
    stream: require.resolve("stream-browserify"),
    buffer: require.resolve("buffer"),
    tls: require.resolve("tls"),
    fs: false,
  }

  config.resolve.extensions = [...config.resolve.extensions, ".ts", ".js"]
  config.plugins = [
    ...config.plugins,
    new NodePolyfillPlugin(),

    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
    new webpack.ProvidePlugin({
      tls: ["tls", "tls"],
    }),
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
  ]
  // config.target = "node"

  console.log(config.resolve)
  console.log(config.plugins)

  process.env.BTC_NETWORK = "testnet"

  return config
}