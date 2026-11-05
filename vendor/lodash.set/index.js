'use strict';

// lodash.set is no longer published; its last release (4.3.2) is vulnerable to
// prototype pollution (GHSA-p6mc-m468-83gw). lodash/set in maintained lodash
// releases has the same signature and refuses __proto__/constructor keys.
module.exports = require('lodash/set');
