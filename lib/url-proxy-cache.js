
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const URL = require("url");
const HTTP = require("http");
const HTTPS = require("https");
const TUNNEL = require("tunnel");
const WRENCH = require("wrench");
const Q = require("./q");
const UTIL = require("./util");


var fetchQueue = {};

var UrlProxyCache = exports.UrlProxyCache = function(path, options) {
    this.path = path;
    this.options = UTIL.copy(options);
    ASSERT(typeof options.ttl !== "undefined", "'options.ttl' required!");
    if (typeof this.options.verbose === "undefined") {
        this.options.verbose = false;
    }
}

function getProxyAgent(urlInfo) {
    function prepare(proxyUrl) {
        var proxyUrlInfo = URL.parse(proxyUrl);
        return [
            proxyUrlInfo,
            {
                proxy: {
                    host: proxyUrlInfo.hostname,
                    port: proxyUrlInfo.port
                }
            }
        ];
    }
    var agent;
    if (urlInfo.protocol === "https:") {
        agent = HTTPS.globalAgent;
        var proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
        if (proxyUrl) {
            var info = prepare(proxyUrl);
            if (info[0].protocol === "https:") {
                agent = TUNNEL.httpsOverHttps(info[1]);
            } else {
                agent = TUNNEL.httpsOverHttp(info[1]);
            }
        }
    } else {
        agent = HTTP.globalAgent;
        var proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || null;
        if (proxyUrl) {
            var info = prepare(proxyUrl);
            if (info[0].protocol === "https:") {
                agent = TUNNEL.httpOverHttps(info[1]);
            } else {
                agent = TUNNEL.httpOverHttp(info[1]);
            }
        }
    }
    return agent;
}

UrlProxyCache.prototype.get = function(url, options, callback) {
    var self = this;

    options = options || {};
    
    var verbose = self.options.verbose;
    if (typeof options.verbose !== "undefined") {
        verbose = options.verbose;
    }

    var urlInfo = self.parseUrl(url);

    return ensureParentPathExists(urlInfo.cachePath, function(err) {
        if (err) return callback(err);

        function fetch(callback) {

            function handleResponse(response, callback) {                
                if (response.status === 301 || response.status === 302) {
                    // Redirect.
                    return self.get(response.headers.location, options, callback);
                } else {
                    return callback(null, response);
                }
            }

            var metaPath = urlInfo.cachePath + "~~meta";
            var pathExists = false;
            
            function getPathMtime(metaPath, path, callback) {
                PATH.exists(metaPath, function(exists) {
                    if (!exists) return callback(null, false);
                    PATH.exists(path, function(exists) {
                        pathExists = exists;
                        FS.stat(metaPath, function(err, stats) {
                            if (err) return callback(err);
                            return callback(null, stats.mtime.getTime());
                        });
                    });
                });
            }
            
            return getPathMtime(metaPath, urlInfo.cachePath, function(err, mtime) {
                if (err) return callback(err);

                var ttl = self.options.ttl;
                // If `options.ttl === false` then defer to instance ttl.
                // If `typeof options.ttl === "undefined"` then defer to instance ttl.
                if (typeof options.ttl !== "undefined" && options.ttl !== false && (options.ttl >= -1 || (options.ttl >= Date.now()*-1 && options.ttl < -1))) {
                    ttl = options.ttl;
                }
                if ((""+Math.abs(ttl)).length === 10) {
                    ttl *= 1000;
                }
                function isCached() {
                    if (ttl >= -1) {
                        // If `ttl === -1` then force cache refresh.
                        // If `ttl === 0` then cache indefinite.
                        // If `ttl >= 1` then cache for ttl (milliseconds).     
                        if (mtime && ttl != -1 && (ttl === 0 || ((mtime + ttl) > new Date().getTime()))) {
                            return true;
                        }
                    } else
                    if (ttl < -1) {
                        if (mtime >= ttl*-1) {
                            return true;
                        }
                    }
                    return false;
                }
                if (isCached()) {

                    function loadCached(callback) {

                        function fail(err) {
                            if (!callback) {
                                console.error(err.stack);
                                return;
                            }
                            callback(err);
                            callback = null;
                        }
                        
                        return FS.readFile(metaPath, function(err, meta) {
                            if (err) return fail(err);
                            try {
                                meta = JSON.parse(meta);
                            } catch(err) {
                                return fail(err);
                            }
                            if (meta.status === 301 || meta.status === 302 || meta.status === 404) {
                                if (verbose) console.log("cached " + meta.status + " " + urlInfo.href);
                                callback(null, meta);
                                callback = null;
                                return;
                            }
                            // If original request was 200 but path no longer exists.
                            if (!pathExists || meta.status === 304) {
                                if (meta.status === 304) {
                                    // TODO: So `meta.status` should never be 304 now? If this is verified we can remove the `meta.status === 304` check.
                                    console.log("TEMPORARY: Re-fetching as meta cache format has changed.");
                                }
                                var opts = UTIL.copy(options);
                                opts.ttl = -1;
                                delete fetchQueue[urlInfo.cachePath];
                                return self.get(url, opts, callback);
                            }
                            meta.status = 304;
                            if (options.loadBody === false) {
                                if (verbose) console.log("cached " + meta.status + " " + urlInfo.href);
                                callback(null, meta);
                                callback = null;
                                return;
                            }
                            return FS.readFile(urlInfo.cachePath, function(err, data) {
                                if (err) {
                                    fail(err);
                                    return;
                                }
                                meta.body = data;
                                if (verbose) console.log("cached " + meta.status + " " + urlInfo.href);
                                callback(null, meta);
                                callback = null;
                            });
                        });
                    }
                    
                    return loadCached(function(err, response) {
                        if (err) return callback(err);
                        return handleResponse(response, callback);
                    });
                }
                else {

                    // TODO: If download already in progress attach to first download.

                    var time = new Date().getTime();
                    var tmpPath = urlInfo.cachePath + "~" + time;
                    var metaTmpPath = metaPath + "~" + time;
                    var meta = {};
                    
                    function writeMeta(callback) {
                        meta.cachePath = urlInfo.cachePath;
                        FS.writeFile(metaTmpPath, JSON.stringify(meta), function(err) {
                            if (err) {
                                callback(err);
                                return;
                            }
                            FS.rename(metaTmpPath, metaPath, function(err) {
                                if (err) {
                                    callback(err);
                                    return;
                                }
                                callback(null);
                            })
                        });
                    }

                    function makeRequest(callback) {
                        function fail(err) {
                            if (!callback) {
                                if (err && err !== true) console.error(err.stack);
                                return;
                            }
                            callback(err);
                            callback = null;
                        }
                        
                        var existingMeta = false;

                        function checkExisting(callback) {

                            // If we have meta data & file exists we send a HEAD request first to see if
                            // anything has changed.
                            
                            if (ttl != -1) {
        
                                return PATH.exists(metaPath, function(exists) {
                                    if (!exists) return callback(null);
                                    
                                    return FS.readFile(metaPath, function(err, data) {
                                        if (err) return fail(err);

                                        existingMeta = JSON.parse(data);
                                  
                                        if (existingMeta.headers.etag) {
                                            // We have an Etag so we just send a 'If-None-Match' header below.
                                            return callback(null);
                                        }

                                        var args = {
                                            host: urlInfo.hostname,
                                            port: urlInfo.port || ((urlInfo.protocol==="https:")?443:80),
                                            path: urlInfo.path,
                                            agent: getProxyAgent(urlInfo),
                                            method: "HEAD"
                                        };

                                        function handleResult(res) {

                                            ASSERT(typeof res === "object");
                                            ASSERT(typeof res.statusCode === "number");
                                            ASSERT(typeof res.headers === "object");

                                            if (verbose) console.log("head " + res.statusCode + " " + urlInfo.href);
                                            if (res.statusCode === 301 || res.statusCode === 302) {
                                                existingMeta.status = res.statusCode;
                                                return callback(null, existingMeta);
                                            } else
                                            if (res.statusCode === 200) {
                                                var same = true;
                                                if (typeof res.headers["content-length"] !== "undefined" && res.headers["content-length"] !== existingMeta.headers["content-length"]) {
                                                    same = false;
                                                }
                                                if (typeof res.headers["content-disposition"] !== "undefined" && res.headers["content-disposition"] !== existingMeta.headers["content-disposition"]) {
                                                    same = false;
                                                }
                                                if (typeof res.headers["etag"] !== "undefined" && res.headers["etag"] !== existingMeta.headers["etag"]) {
                                                    same = false;
                                                }
                                                // TODO: Check some other fields like 'Etag'?
                                                if (same) {
                                                    existingMeta.status = 304;

                                                    var time = new Date();
                                                    FS.utimesSync(metaPath, time, time);
                                                    if (verbose) console.log("touched " + metaPath);

                                                    if (options.loadBody === false) {
                                                        if (verbose) console.log("emit " + existingMeta.status + " " + urlInfo.href);
                                                        return callback(null, existingMeta);
                                                    }
                                                    return FS.readFile(urlInfo.cachePath, function(err, data) {
                                                        if (err) {
                                                            fail(err);
                                                            return;
                                                        }
                                                        existingMeta.body = data;
                                                        if (verbose) console.log("emit " + existingMeta.status + " " + urlInfo.href);
                                                        return callback(null, existingMeta);
                                                    });
                                                }
                                            }
                                            return callback(null);
                                        }

                                        if (typeof options.responder === "function") {

                                            if (verbose) console.log("responder HEAD " + urlInfo.href);
            
                                            options.responder(args, function(err, result) {
                                                if (err) return fail(err);
                                                try {
                                                    return handleResult(result);
                                                } catch(err) {
                                                    return fail(err);
                                                }
                                            });

                                        } else {

                                            if (verbose) console.log("http HEAD " + urlInfo.href);
                                            var request = ((urlInfo.protocol==="https:")?HTTPS:HTTP).request(args, function(res) {
                                                res.on("end", function() {
                                                    try {
                                                        return handleResult(res);
                                                    } catch(err) {
                                                        return fail(err);
                                                    }
                                                });
                                            });
                                            request.on("error", function(err) {
                                                // May not want to fail here but try again or make GET request?
                                                fail(err);
                                            });
                                            request.end();
                                        }
                                    });
                                });
                            }
                        }

                        return checkExisting(function(err, foundExisting) {
                            if (err) return fail(err);
                            if (foundExisting) {
console.log("found existing!!!!", foundExisting);
                                return callback(null, foundExisting);
                            }

                            var writeStream = FS.createWriteStream(tmpPath);
                            writeStream.on("error", fail);
                            writeStream.on("close", function() {
                                if (callback) {
                                    // Success.
                                    writeMeta(function(err) {
                                        if (err) return fail(err);
                                        FS.rename(tmpPath, urlInfo.cachePath, function(err) {
                                            if (err) return fail(err);
                                            if (options.loadBody === false) {
                                                callback(null, meta);
                                                callback = null;
                                                return;
                                            }
                                            FS.readFile(urlInfo.cachePath, function(err, data) {
                                                if (err) return fail(err);
                                                meta.body = data;
                                                callback(null, meta);
                                                callback = null;
                                            });
                                        });
                                    });
                                } else {
                                    // We had an error.
                                    FS.unlink(tmpPath, function(err) {
                                        if (err) console.error(err.stack);
                                    });
                                }
                            });
                            
                            var headers = {};
                            if (existingMeta && existingMeta.headers.etag && ttl != -1) {
                                headers["If-None-Match"] = existingMeta.headers.etag;
                            }

                            var args = {
                                host: urlInfo.hostname,
                                port: urlInfo.port || ((urlInfo.protocol==="https:")?443:80),
                                path: urlInfo.path,
                                agent: getProxyAgent(urlInfo),
                                method: "GET",
                                headers: headers
                            };

                            function handleResult(res) {
                                ASSERT(typeof res === "object");
                                ASSERT(typeof res.statusCode === "number");
                                ASSERT(typeof res.headers === "object");
                                ASSERT(typeof res.on === "function");

                                if (verbose) console.log("get " + res.statusCode + " " + urlInfo.href);
                                if (res.statusCode == 304) {
                                    existingMeta.status = 304;
                                    
                                    var time = new Date();
                                    FS.utimesSync(metaPath, time, time);
                                    if (verbose) console.log("touched " + metaPath);

                                    if (options.loadBody === false) {
                                        if (verbose) console.log("emit " + existingMeta.status + " " + urlInfo.href);
                                        callback(null, existingMeta);
                                        callback = null;
                                        writeStream.end();
                                        return;
                                    }
                                    FS.readFile(urlInfo.cachePath, function(err, data) {
                                        if (err) return fail(err);
                                        existingMeta.body = data;
                                        if (verbose) console.log("emit " + existingMeta.status + " " + urlInfo.href);
                                        callback(null, existingMeta);
                                        callback = null;
                                        writeStream.end();
                                    });
                                    return;
                                }

                                meta.status = res.statusCode;
                                meta.headers = res.headers;
                                
                                if (res.statusCode !== 200) {
                                    writeMeta(function(err) {
                                        if (err) return fail(err);
                                        if (verbose) console.log("emit " + meta.status + " " + urlInfo.href);
                                        callback(null, meta);
                                        callback = null;
                                        writeStream.end();
                                    });
                                    return;
                                }
                                res.on("data", function(chunk) {
                                    // TODO: Nicer download progress.
    //                                process.stdout.write(".");
                                    writeStream.write(chunk, "binary");
                                });
                                res.on("end", function() {
                                    writeStream.end();
                                });
                            }

                            if (typeof options.responder === "function") {

                                if (verbose) console.log("responder GET " + urlInfo.href);

                                options.responder(args, function(err, result) {
                                    if (err) return fail(err);
                                    try {
                                        return handleResult(result);
                                    } catch(err) {
                                        return fail(err);
                                    }
                                });

                            } else {
                                if (verbose) console.log("http GET " + urlInfo.href);
                                var request = ((urlInfo.protocol==="https:")?HTTPS:HTTP).request(args, handleResult);
                                request.on("error", fail);
                                request.end();
                            }
                        });
                    }

                    return makeRequest(function(err, response) {
                        if (err) return callback(err);
                        return handleResponse(response, callback);
                    });
                }
            });
        }

        if (fetchQueue[urlInfo.cachePath]) {
            if (UTIL.isArrayLike(fetchQueue[urlInfo.cachePath])) {
                // Not fetched yet.
                fetchQueue[urlInfo.cachePath].push(callback);
            } else {
                // Already fetched.
                return callback(null, fetchQueue[urlInfo.cachePath]);
            }
        } else {
            fetchQueue[urlInfo.cachePath] = [
                callback
            ];
            return fetch(function(err, info) {
                if (err) {
                    fetchQueue[urlInfo.cachePath].forEach(function(callback) {
                        return callback(err);
                    });
                    delete fetchQueue[urlInfo.cachePath];
                    return;
                }
                fetchQueue[urlInfo.cachePath].forEach(function(callback) {
                    return callback(null, info);
                });
                delete fetchQueue[urlInfo.cachePath];
                return;
            });
        }
    });
}

UrlProxyCache.prototype.parseUrl = function(url) {
    var urlInfo = URL.parse(url);
    urlInfo.cachePath = PATH.join(this.path, urlInfo.protocol.replace(/:$/, ""), urlInfo.hostname, urlInfo.path).replace(/\/$/, "+");
    return urlInfo;
}


var lastRemovedPath = false;
function ensureParentPathExists(path, callback) {
    return PATH.exists(PATH.dirname(path), function(exists) {
        if (exists) return callback(null);
        try {
            WRENCH.mkdirSyncRecursive(PATH.dirname(path));
            lastRemovedPath = false;
            return callback(null);
        } catch(err) {
            if (err.code === "ENOTDIR") {
                // We encountered a file along the path hierarchy that needs to be removed before we can create the rest of the dirs.
                // This may happen if a more general URL is requested and then a sub-path subsequently.
                // We assume that the most specific path is the valid one and remove the file in the parent path.
                // TODO: Find a better way to get the path to remove than taking it from the error message.
                var parentPath = path;
                while(true) {
                    if (!PATH.existsSync(parentPath)) {
                        if (parentPath === PATH.dirname(parentPath)) {
                            lastRemovedPath = false;
                            return callback(err);
                        }
                        parentPath = PATH.dirname(parentPath);
                    } else
                    if (!FS.statSync(parentPath).isDirectory()) {
                        lastRemovedPath = parentPath;
                        console.log("WARN: Removing file at '" + lastRemovedPath + "' as directory is expected!");                
                        FS.unlinkSync(lastRemovedPath);
                        break;
                    }
                }
                return ensureParentPathExists(path, callback);
            }
            lastRemovedPath = false;
            return callback(err);
        }
    });
}


