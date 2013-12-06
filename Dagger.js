module.exports = (function(){

var http = require("http");
var url = require("url");
var util = require("util");
var fs = require("fs");

var formidable = require("formidable");

////////////////////////////////////////////////////////////////

function _extend(obj)
{
	var recurse = arguments.callee;
	Array.prototype.slice.call(arguments, 1).forEach(function(source)
	{
		for(var prop in source)
		{
			if(source[prop] instanceof Array)
				obj[prop] = ((obj[prop] instanceof Array)? obj[prop] : []).concat(source[prop]);
			else if((typeof(obj[prop]) == "object") && (typeof(source[prop]) == "object"))
				recurse(obj[prop], source[prop]);
			else
				obj[prop] = source[prop];
		}
	});
	return(obj);
}

////////////////////////////////////////////////////////////////

var mimeTypes =
{
	"html": "text/html",
	"js": "application/javascript",
	"css": "text/css",
	"png": "image/png",
	"jpeg": "image/jpeg",
	"txt": "text/plain",
};
var defaultMimeType = "application/octet-stream";

function mimeLookup(path, fallback)
{
	//borrowed from https://github.com/broofa/node-mime
	return(mimeTypes[path.replace(/.*[\.\/]/, '').toLowerCase()] || fallback || defaultMimeType);
}

////////////////////////////////////////////////////////////////

Server.prototype =
{
	api: null,
	server: null,
	
	rootServer: function Server_rootServer(request, response)
	{
		var args = url.parse(request.url, true), result = undefined;
		request.method = request.method.toUpperCase();
		request.args =
		{
			query: args.query
		};	//gets extended during request processing
		
		var urlParts = args.pathname.split("/").filter(function(p){return(p != "");});
		
		var handler = this.api[urlParts[0] || "/"];
		request.urlParts = urlParts;
		if(handler && (typeof(handler.handler) == "function"))
		{
			request.urlParts.shift();	//discard the first part
			result = handler.handler(request, response);
		}
		else if(typeof(handler) == "function")
		{
			request.urlParts.shift();	//discard the first part
			result = handler(request, response);
		}
		else
			result = false;

		if((result === false) && ((typeof(this.api[""]) != "function") || (this.api[""](request, response) === false)))
		{
			console.warn("Dagger: Error, unhandled URL (404): ", urlParts[0] || "/", handler);
			this.error404(request, response);
		}
	},
	
	error404: function Server_error404(request, response)
	{
		response.writeHead(404, {"Content-Type": "text/plain"});
		response.end("404");
	},
};
function Server(api, port)
{
	this.api = api || {"/": this.error404};
	
	this.server = http.createServer(this.rootServer.bind(this));
	this.server.listen(port || 8000);
}

////////////////////////////////////////////////////////////////

//simplest practical static file server with zero features, used if you don't want to include anything else

function createStaticFileServer(base, defaultURL)
{
	return(function StaticFileServer_serve(request, response)
	{
		//sanitize url by filtering out path-unfriendly sequences
		var url = request.url.split("/").filter(function(p){return((p != "") && (p != ".."));}).join("/");
		
		url = (url == "")? defaultURL : url;
		
		var urlPath = (base == "")? url : ((base + "/") + url);
		var resourceMIME = mimeLookup(urlPath);
		
		//console.warn("Requesting: ", request.url, " => ", urlPath, "(" + resourceMIME + ")");
		
		var f = fs.createReadStream(urlPath).on("open", function StaticFileServer_serve_file(fd)
		{
			response.writeHead(200,
			{
				"Content-Type": resourceMIME
			});
			f.pipe(response);	//send the file through
			
		}).on("error", function StaticFileServer_serve_error(e)
		{
			var code = (e.code == "ENOENT")? 404 : 500;	//minimal error handler
			
			//console.warn("failed (" + code + "): ", url);
			
			response.writeHead(code, {"Content-Type": "text/plain"});
			response.end(code.toString());
			f.destroy();
		});
	});
}

////////////////////////////////////////////////////////////////

Router.prototype =
{
	add: function Router_add(urlParts, handler, type, varStack)
	{
		var part;
		//for cases where a urlVariable is the last component of a scheme, part is null
		//part is also null for a urlVariable component
		if((urlParts.length > 0) && (urlParts[0].substr(0, 1) == ":"))	//variable
		{
			varStack.push(urlParts[0].substr(1));
			urlParts.shift();
			part = null;
		}
		else
			part = urlParts.shift();
		
		//pass remaining parts to the correct sub-api (creating one if needed, by instantiating this function (whoa))
		var branch = (this.api[part] || (this.api[part] = new type()));
		
		if(urlParts.length > 0)
		{
			branch.add(urlParts, handler, type, varStack);
		}
		else
		{
			branch.handler = handler;
			branch.varStack = varStack;
		}
	},
	
	handler: function Router_handler(request, response)
	{
		var branch, urlVariable;
		if(request.urlParts.length == 0)
			branch = this.api["/"];
		else
		{
			branch = this.api[request.urlParts[0]];
			if(!branch)
			{
				(request.args.urlArray || (request.args.urlArray = [])).push(request.urlParts[0]);
				branch = this.api[null];
			}
		}
		
		if(branch)
		{
			if(branch.varStack)
			{
				if(!request.args.url)	request.args.url = {};
				for(var i = 0; i < branch.varStack.length; i++)
					request.args.url[branch.varStack[i]] = request.args.urlArray[i];
			}
			
			request.urlParts.shift();
		}
		if(!branch || (branch.handler(request, response) === false))
		{
			//look for a 404 handler at this level
			if(this.api[""])
				this.api[""](request, response);
			else
				return(false);
		}
	}
};
function Router(api)
{
	this.api = {};
	
	if(api)
		for(var urlScheme in api)
		{
			if(urlScheme)
			{
				var parts = urlScheme.split("/").filter(function(p){return(p != "");});
				parts.push("/");
				this.add(parts, api[urlScheme], arguments.callee, []);
			}
			else
				this.api[urlScheme] = api[urlScheme];
		}
};

////////////////////////////////////////////////////////////////

var kAPIEndpointTypes =
{
	"raw":	{},
	"json": {"Content-Type": "application/javascript"},
	"xml": {"Content-Type": "text/xml"},
	"html": {"Content-Type": "text/html"},
	"text": {"Content-Type": "text/plain"},
};

function APIEndpoint(handler, context, type)
{
	type = type || "json";
	var defaultHeaders = _extend({}, kAPIEndpointTypes[type] || {});
	
	return(function APIEndpoint_endpoint(request, response)
	{
		var wroteHead = false;
		var originalWriteHead = response.writeHead;
		response.writeHead = function APIEndpoint_writeHead(code, phrase, headers)
		{
			if(wroteHead)	return;
			originalWriteHead.apply(this, arguments);
			wroteHead = true;
		}
		var finish = function APIEndpoint_finish(result, httpCode, headers)
		{
			response.writeHead(httpCode || 200, _extend(defaultHeaders, headers));
			if(result === undefined)
				response.end();
			else if(typeof(result) == "string")
				response.end(result);
			else if(type =="json")
				response.end(JSON.stringify(result));
			else if(type == "xml")
				response.end(XML(result));	//would need XML module: npm("xml"), require("xml")
			else if(result instanceof Buffer)
				response.end(result);
			else
				response.end(String(result));
		};
		
		try
		{
			if(request.method == "POST")
			{
				var form = new formidable.IncomingForm();
				form.parse(request, function(err, fields, files)
				{
					request.args.post = fields;
					request.args.files = files;
					handler.call(context || this, request, response, request.args, finish);
				});
			}
			else
				handler.call(context || this, request, response, request.args, finish);
		}
		catch(err)
		{
			console.warn("Dagger: Error thrown: ", util.inspect(err), err.stack);
			finish(String(err), 500);
		}
	});
}
////////////////////////////////////////////////////////////////

return(
{
	Server: Server,
	Router: Router,
	APIEndpoint: APIEndpoint,
	createStaticFileServer: createStaticFileServer,
	mime: mimeLookup
});

})();
