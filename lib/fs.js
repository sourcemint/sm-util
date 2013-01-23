
const FS_EXTRA = require("fs-extra");

for (var key in FS_EXTRA) {
    exports[key] = FS_EXTRA[key];
}
