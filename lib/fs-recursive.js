
const PATH = require("path");
const DEPRECATED = require("./deprecated");

// Needed for `wrench` for older NodeJS versions.
if (typeof PATH.sep === "undefined") {
    PATH.sep = (process.platform === "win32") ? "\\" : "/";
}

const FS = require("./fs");
const WRENCH = require("wrench");
const EXEC = require("child_process").exec;
const Q = require("./q");


for (var key in WRENCH) {
    exports[key] = function() {
        DEPRECATED.deprecated({
            instead: 'require("sourcemint-util-js/lib/fs") (https://github.com/jprichardson/node-fs-extra)'
        });
        return WRENCH[key].apply(null, arguments);
    }
}


exports.osCopyDirRecursive = function(fromPath, toPath) {

    DEPRECATED.deprecated({
        instead: 'require("sourcemint-util-js/lib/fs").copy()'
    });

    var deferred = Q.defer();

    if (!FS.existsSync(toPath)) {
        FS.mkdirSync(toPath);
    }

    // NOTE: This does not copy dir on Ubuntu as it does on OSX: `"cp -R " + fromPath + "/ " + toPath`
    // @see http://superuser.com/questions/215514/in-ubuntu-how-to-copy-all-contents-of-a-folder-to-another-folder
    EXEC('tar pcf - .| (cd "' + toPath + '"; tar pxf -)', {
        cwd: fromPath
    }, function(error, stdout, stderr) {
        if (error || stderr) {
            deferred.reject(new Error(stderr));
            return;
        }
        deferred.resolve();
    });

    return deferred.promise;
}


exports.rmSyncRecursive = function(path) {

    DEPRECATED.deprecated({
        instead: 'require("sourcemint-util-js/lib/fs").removeSync()'
    });

    if (FS.statSync(path).isDirectory()) {
        exports.rmdirSyncRecursive(path);
    } else {
        FS.unlinkSync(path);
    }
}

