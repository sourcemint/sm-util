
const PATH = require("path");
const UTIL = require("../lib/util");
const ERROR = require("../lib/error");
const WAITFOR = require("../lib/wait-for");
const URL_PROXY_CACHE = require("../lib/url-proxy-cache");


exports.main = function(callback) {

	var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(__dirname, ".cache"), {
        ttl: 0    // Indefinite by default.
    });

    var index = 0;

	function makeRequest(url, callback) {
		index++;
		var ourIndex = index;
	    console.log("==> MAKE REQUEST: " + ourIndex);

		return cache.get(url, {
			verbose: true,
            debug: true,
            loadBody: true
		}, function(err, response) {
			if (err) return callback(err);

		    console.log("==> REQUEST DONE: " + ourIndex);

		    if (response.status === 404) return callback(null);

			try {
				JSON.parse(response.body);
			} catch(err) {
				console.log("WARN", "Error parsing JSON for", url);
			}

			return callback(null);
		});
	}

	var waitfor = WAITFOR.serial(callback);

	for (var i=0 ; i<100 ; i++) {
		waitfor(function(callback) {

			makeRequest("https://raw.github.com/sourcemint/sm-util/master/package.json", callback);

		});
	}

	waitfor();
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) return ERROR.exitProcessWithError(err);
		process.exit(0);
	});
}
