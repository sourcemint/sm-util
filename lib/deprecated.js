

const STACK_TRACE = require("stack-trace");


exports.deprecated = function(options) {
	options = options || {};

	var trace = STACK_TRACE.get();

	var msg = [
		"DEPRECATED:",
		"`" + trace[1].getMethodName() + "()`",
		"called at",
		trace[2].getFileName(),
		":",
		trace[2].getLineNumber()
	];

	if (options.instead) {
		msg.push("(use");
		msg.push(options.instead);
		msg.push("instead)");
	}

	console.warn(msg.join(" "));
}
