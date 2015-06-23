var Client = require('..').client;

// remote service interface path info list
var records = [
    {namespace: 'user', serverType: 'test', path: __dirname + '/remote/test'}
];

var context = {
    serverId: 'test-server-1'
};

// server info list
var servers = [
    {id: 'test-server-1', serverType: 'test', host: '127.0.0.1', port: 3333}
];

// route parameter passed to route function
var routeParam = null;

// route context passed to route function
var routeContext = servers;

// route function to caculate the remote server id
var routeFunc = function (routeParam, msg, routeContext, cb) {
    cb(null, routeContext[0].id);
};

var client = Client.create({
    routeContext: routeContext,
    router: routeFunc,
    context: context,
    pendingSize: 10e4,
    rpcType: "zmq"
});


var genny = require("genny")
var suspend = require("suspend")
var resume = suspend

client.start(function (err) {
    console.log('rpc client start ok.');

    client.addProxies(records);
    client.addServers(servers);


    var n = 10000, t
    suspend.run(function*(resume) {
        var st = Date.now()
        for(var i = 0;i<n;i++){
            yield client.proxies.user.test.service.echo(routeParam, 'hello', resume())
        }
        t = Date.now() - st
        console.log("顺序req:%d times,  use time:%d, rps:%d", n, t, n / t * 1000)

        st = Date.now()
        for (var i = 0; i < n; i++) {
            client.proxies.user.test.service.echo(routeParam, 'hello', suspend.fork())
        }

        var ret = yield suspend.join()
        t =  Date.now() - st
        console.log("并发req:%d times,  use time:%d, rps:%d", n, t, n / t * 1000)
        //console.log(ret);


        //for (var i = 0; i < n; i++) {
        //    client.proxies.user.test.service.echo(routeParam, 'hello', resume())
        //}
        //
        //for (var i = 0; i < n; i++) {
        //    yield resume
        //}
        return true
    }, function (err, ret) {
        if(err){
            throw err
        }
        console.log("done..");
    })

    //client.proxies.user.test.service.echo(routeParam, 'hello', function(err, resp) {
    //  if(err) {
    //    console.error(err.stack);
    //  }
    //  console.log(resp);
    //});
});