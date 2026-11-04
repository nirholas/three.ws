'use strict';

// lodash.set 4.3.2 is the last standalone release and still lets a path such as
// ['__proto__', 'polluted'] or 'constructor.prototype.polluted' write onto
// Object.prototype (GHSA-p6mc-m468-83gw); upstream never patched it. lodash's
// own set() guards __proto__, constructor and prototype keys in baseSet, so the
// standalone module is served by the maintained implementation with the same
// set(object, path, value) signature.
module.exports = require('lodash/set');
