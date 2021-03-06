
const ASSERT = require("assert");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const TERM = require("./term");
const NETUTIL = require("netutil");
const Q = require("./q");
const UTIL = require("./util");
const FS = require("./fs");


exports.isSudo = function() {
	if (
		typeof process.env.SUDO_USER === "string" ||
	    typeof process.env.SUDO_UID === "string" ||
	    typeof process.env.SUDO_GID === "string"
	) {
		return true;
	}
	return false;
}

exports.which = function(commandName) {
    var deferred = Q.defer();
    var command = (process.platform === "win32" ? "where" : "which") + " " + commandName;
    EXEC(command, function(error, stdout, stderr) {
        if (error || stderr) {
            return deferred.resolve(false);
        }
		var m = stdout.match(/^(.*)\n$/);
		if (!m) {
			return deferred.reject(new Error("Error parsing command path from `which` result [" + stdout + "]"));
		}
        deferred.resolve(m[1]);
    });
    return deferred.promise;
}

exports.isPidAlive = function(path, callback) {
	if (!FS.existsSync(path)) return callback(null, false);
	return EXEC("kill -0 " + FS.readFileSync(path), function(error, stdout, stderr) {
		if (error || stderr) return callback(null, false);
		return callback(null, true);
	});
}

exports.exec = function(command, options) {
	var deferred = Q.defer();
	EXEC(command, options || {}, function(error, stdout, stderr) {
		// TODO: See why `sm *` writes `\[0m` to stderr.
	    if (error || (stderr && !((stderr.length === 4 || stderr.length === 8) && stderr.charAt(1) === "["))) {
	    	TERM.stderr.writenl("\0red(" + stderr + "\0)");
	        return deferred.reject(new Error("Error running os command: " + command));
	    }
	    return deferred.resolve(stdout);
	});
	return deferred.promise;
}

exports.getEnvPath = function(extra) {
	if (!UTIL.isArrayLike(extra)) extra = [ extra ];
	// TODO: Use different delimiters for different `process.platform`.
	return extra.concat(process.env.PATH.split(":")).join(":");
}

exports.spawnInline = function(command, args, options) {
    options = options || {};
    var deferred = Q.defer();
    try {
	    ASSERT(typeof options.cwd !== "undefined");

	    if (options.logger) options.logger.debug("Running: " + command + " " + args.join(" ") + " (cwd: " + options.cwd + ")");

	    var opts = {
	        cwd: options.cwd,
	        env: process.env
	    };
	    if (options.env) {
	    	UTIL.update(opts.env, options.env);
	    }

        if (!options.returnOutput) {
		    opts.stdio = "inherit";    // NodeJS 0.8+
		}

	    var output = {
	    	stdout: "",
	    	stderr: ""
	    };

        var proc = SPAWN(command, args, opts);
        proc.on("error", function(err) {
            return deferred.reject(err);
        });
        proc.on("exit", function(code) {
	        if (code !== 0) {
	            return deferred.reject(new Error("Error running: " + command + " " + args.join(" ") + " (cwd: " + options.cwd + ")"));
	        }
	        if (options.returnOutput) {
	            return deferred.resolve(output);
	        }
            return deferred.resolve();
        });
        // NodeJS 0.6
        if (/^v0\.6\./.test(process.version)) {
	    	if (options.logger) options.logger.warn("For best results use NodeJS 0.8");
            proc.stdout.on("data", function(data) {
                process.stdout.write(data);
		        if (options.returnOutput) {
		        	output.stdout += data.toString();
		        }
            });
            proc.stderr.on("data", function(data) {
                process.stderr.write(data);
		        if (options.returnOutput) {
		        	output.stderr += data.toString();
		        }
            });
            process.stdin.resume();
            process.stdin.on("data", function (chunk) {
                // TODO: For some reason this input gets printed to process.stdout after hitting return.
                proc.stdin.write(chunk);
            });
        } else {
        	// NodeJS 0.8+
	        if (options.returnOutput) {
	            proc.stdout.on("data", function(data) {
	                process.stdout.write(data);
		        	output.stdout += data.toString();
	            });
	            proc.stderr.on("data", function(data) {
	                process.stderr.write(data);
		        	output.stderr += data.toString();
	            });
	        }
        }
	} catch(err) {
		return deferred.reject(err);
	}
    return deferred.promise;
}

exports.getTmpPort = function(callback) {
    // @see http://en.wikipedia.org/wiki/Ephemeral_port
    var start = 50000;
    var end = 65000;
    // TODO: Adjust port range based on `process.platform`.
    return NETUTIL.findFreePort(start, end, "localhost", callback);
}
