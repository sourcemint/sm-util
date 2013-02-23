
const FS_EXTRA = require("fs-extra");
const NCP = require("fs-extra/node_modules/ncp");

for (var key in FS_EXTRA) {
    exports[key] = FS_EXTRA[key];
}

// @see https://github.com/AvianFlu/ncp
exports.copy2 = NCP.ncp;
