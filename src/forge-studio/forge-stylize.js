// Forge Studio uses the same Stylize panel as /forge: the result viewer and the
// stylize panel share their ids, so one module serves both pages and they cannot
// drift apart again (the copy that lived here had fallen behind on error copy
// and on ignoring tab-local blob sources).
import '../forge-stylize.js';
