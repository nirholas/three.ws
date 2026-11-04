'use strict';
const { nanoid } = require('nanoid3');

module.exports = function generate(size) {
  return nanoid(size);
};
