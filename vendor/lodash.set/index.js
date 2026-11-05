'use strict';

<<<<<<< HEAD
// lodash.set 4.3.2 is the last standalone release and still lets a path such as
// ['__proto__', 'polluted'] or 'constructor.prototype.polluted' write onto
// Object.prototype (GHSA-p6mc-m468-83gw); upstream never patched it. lodash's
// own set() guards __proto__, constructor and prototype keys in baseSet, so the
// standalone module is served by the maintained implementation with the same
// set(object, path, value) signature.
=======
// lodash.set is no longer published; its last release (4.3.2) is vulnerable to
// prototype pollution (GHSA-p6mc-m468-83gw). lodash/set in maintained lodash
// releases has the same signature and refuses __proto__/constructor keys.
>>>>>>> threews/main
module.exports = require('lodash/set');
