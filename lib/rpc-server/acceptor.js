//var acceptor = require('./acceptors/ws-acceptor');
// var acceptor = require('./acceptors/websocket-acceptor');
//var acceptor = require('./acceptors/tcp-acceptor');
module.exports.create = function(opts, cb) {
  opts.rpcType =  opts.rpcType || "sio";
  var acceptor = require('./acceptors/'+ opts.rpcType + '-acceptor');
  return acceptor.create(opts, cb);
};