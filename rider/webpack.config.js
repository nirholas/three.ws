var ip = require('ip');
var path = require('path');
var webpack = require('webpack');
const COLORS = require('./src/constants/colors.js');

PLUGINS = [
  new webpack.EnvironmentPlugin(['DEBUG_LOG', 'NODE_ENV']),
  new webpack.HotModuleReplacementPlugin(),
  // @firebase/polyfill not loading, stub it with some random module.
  new webpack.NormalModuleReplacementPlugin(
    /firebase\/polyfill/,
    '../../../../src/constants/colors.js'
  )
];

module.exports = {
  optimization: {
    minimize: process.env.NODE_ENV === 'production'
  },
  devServer: {
    disableHostCheck: true,
    hotOnly: true,
    sockPort: 'location',
    sockHost: process.env.CODESPACE_NAME
      ? `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`
      : undefined,
    proxy: {
      '/r2-proxy': {
        target: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev',
        changeOrigin: true,
        secure: true,
        pathRewrite: { '^/r2-proxy': '' }
      }
    }
  },
  entry: {
    build: './src/index.js',
    zip: './src/workers/zip.js'
  },
  output: {
    globalObject: 'this',
    path: __dirname,
    filename: 'build/[name].js'
  },
  plugins: PLUGINS,
  module: {
    rules: [
      {
        test: /\.js/,
        exclude: /(node_modules)/,
        use: ['babel-loader', 'aframe-super-hot-loader']
      },
      {
        test: /\.json/,
        exclude: /(node_modules)/,
        type: 'javascript/auto',
        loader: ['json-loader']
      },
      {
        test: /\.html/,
        exclude: /(node_modules)/,
        use: [
          'aframe-super-hot-html-loader',
          {
            loader: 'super-nunjucks-loader',
            options: {
              globals: {
                DEBUG_AFRAME: !!process.env.DEBUG_AFRAME,
                DEBUG_LOG: !!process.env.DEBUG_LOG,
                DEBUG_KEYBOARD: !!process.env.DEBUG_KEYBOARD,
                DEBUG_INSPECTOR: !!process.env.DEBUG_INSPECTOR,
                HOST: ip.address(),
                IS_PRODUCTION: process.env.NODE_ENV === 'production',
                COLORS: COLORS
              },
              path: path.resolve(__dirname, 'src')
            }
          },
          {
            loader: 'html-require-loader',
            options: {
              root: path.resolve(__dirname, 'src')
            }
          }
        ]
      },
      {
        test: /\.glsl/,
        exclude: /(node_modules)/,
        loader: 'webpack-glsl-loader'
      },
      {
        test: /\.css$/,
        exclude: /(node_modules)/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpg|svg)/,
        loader: 'url-loader'
      }
    ]
  },
  resolve: {
    modules: [path.join(__dirname, 'node_modules')]
  }
};
