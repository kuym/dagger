## Dagger
### Minimal API web server framework for Node.js

** Alpha, use at your own risk **

Dagger is the backend of a minimal web API server for rapidly prototyping super-lightweight node.js services.

Dagger offers:

- The ability to rapidly develop web APIs and flexibly integrate services of all types in minimal time.
- An incredibly tight end product. None of the dependency bloat or slow startup of Express.js
- Predictability, readability and maintainability of its code.

Express and other web frameworks encourage anti-patterns like the Connect-style responder chain, which distributes
portions of the request-parsing and response-generating code into vastly different (sometimes opaque) places in your
source and decreases predictability (and maintainability.) Dagger is totally focused on making the HTTP request-response
paradigm straightforward, even in the most complex cases.  Nobody modifies the request or messes with the response but you.


#### Installation

  npm install dagger
  
#### Usage

    var server = new Dagger.Server(
    { "/":     homeServer,
      "static":  staticServer,
      "api":     new Dagger.Router(
      {
        "/users": Dagger.APIEndpoint(users.getAll, users),
        "/users/:username": Dagger.APIEndpoint(users.getByName, users),
      }),
    }, 8000);
    
    function getAll(request, response, args, callback)
    {
      storageLayer.users.all(function(err, users)
      {
        if(err)
          return(callback(undefined, 500));  //return HTTP 500 and no data
        
        if(users.length == 0)
          return(callback([], 404));  //return HTTP 404 and an empty list
    
        callback(users);  //returning HTTP 200 is the default
      });
    }
    
    function getByName(request, response, args, callback)
    {
      storageLayer.users.some({name: args.url.username}, function(err, user)
      {
        if(err)
          return(callback(undefined, 500));  //return HTTP 500 and no data
        
        callback(user);
      }
    }
