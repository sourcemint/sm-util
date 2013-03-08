
const ERROR = require("sm-util/lib/error");


require("./url-proxy-cache").main(function(err) {
	if (err) return ERROR.exitProcessWithError(err);
	process.exit(0);
});
