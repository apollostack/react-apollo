import commonjs from 'rollup-plugin-commonjs';
import node from 'rollup-plugin-node-resolve';
import { uglify } from 'rollup-plugin-uglify';
import replace from 'rollup-plugin-replace';

function onwarn(message) {
  const suppressed = ['UNRESOLVED_IMPORT', 'THIS_IS_UNDEFINED'];

  if (!suppressed.find(code => message.code === code)) {
    return console.warn(message.message);
  }
}

function cjs(inputFile, outputFile) {
  return {
    input: inputFile,
    output: {
      file: outputFile,
      format: 'cjs',
    },
    plugins: [
      node({
        module: true,
        only: ['tslib']
      }),
      commonjs({ exclude: 'node_modules/**'})
    ],
    onwarn,
  }
}

// TODO: add CJS explicit CJS bundle or is the tsc generated one sufficient?
function esm(inputFile, outputFile) {
  return {
    input: inputFile,
    output: {
      file: outputFile,
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      node({
        module: true,
        only: ['tslib']
      }),
    ],
    onwarn,
  }
}

function umd(inputFile, outputFile) {
  return {
    input: inputFile,
    output: {
      file: outputFile,
      format: 'umd',
      name: 'react-apollo',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      node({
        module: true,
        only: ['tslib']
      }),
    ],
    onwarn,
  };
}

export default [
  // for browser
  umd("lib/browser.js",
      "lib/react-apollo.browser.umd.js"),
  // for server
  umd("lib/index.js",
      "lib/react-apollo.umd.js"),
  // for test-utils
  umd("lib/test-utils.js",
      "lib/test-utils.js"),
  // for test-links
  umd("lib/test-links.js",
      "lib/test-links.js"),
  // Enable `import { walkTree } from "react-apollo/walkTree"`
  umd("lib/walkTree.js",
      "lib/walkTree.js"),
  esm('lib/index.js', 'lib/react-apollo.esm.js'),
  cjs('lib/index.js', 'lib/react-apollo.cjs.js'),
  // for filesize
  {
    input: 'lib/react-apollo.browser.umd.js',
    output: {
      file: 'dist/bundlesize.js',
      format: 'cjs',
      exports: 'named',
    },
    plugins: [
      node({
        module: true,
        only: ['tslib']
      }),
      commonjs({
        ignore: [
          'react',
          'react-dom/server',
          'apollo-client',
          'graphql',
          'graphql-tag',
        ],
      }),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      uglify(),
    ],
    onwarn,
  },
];
