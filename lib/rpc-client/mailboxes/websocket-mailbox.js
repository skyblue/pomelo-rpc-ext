var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../../util/utils');
var wsClient = require('ws');
var zlib = require('zlib');
var Tracer = require('../../util/tracer');
var logger = require('pomelo-logger').getLogger('pomelo-rpc', __filename);
var DEFAULT_CALLBACK_TIMEOUT = 10 * 1000;
var DEFAULT_INTERVAL = 50;

var KEEP_ALIVE_TIMEOUT = 10 * 1000;
var KEEP_ALIVE_INTERVAL = 30 * 1000;

var DEFAULT_ZIP_LENGTH = 1024 * 10;
var useZipCompress = false;

var MailBox = function(server, opts) {
  EventEmitter.call(this);
  this.id = server.id;
  this.host = server.host;
  this.port = server.port;
  this.requests = {};
  this.timeout = {};
  this.curId = 0;
  this.queue = [];
  this.bufferMsg = opts.bufferMsg;
  this.interval = opts.interval || DEFAULT_INTERVAL;
  this.timeoutValue = opts.timeout || DEFAULT_CALLBACK_TIMEOUT;
  this.connected = false;
  this.closed = false;
  this.opts = opts;
  this._KPinterval = null;
  this._KP_last_ping_time = -1;
  this._KP_last_pong_time = -1;
  DEFAULT_ZIP_LENGTH = opts.doZipLength || DEFAULT_ZIP_LENGTH;
  useZipCompress = opts.useZipCompress || false;
};
util.inherits(MailBox, EventEmitter);

var  pro = MailBox.prototype;

pro.connect = function(tracer, cb) {
  tracer.info('client', __filename, 'connect', 'ws-mailbox try to connect');
  if(this.connected) {
    tracer.error('client', __filename, 'connect', 'mailbox has already connected');
    utils.invokeCallback(cb, new Error('mailbox has already connected.'));
    return;
  }

  this.socket = wsClient.connect('ws://' + this.host + ':' + this.port);
  //this.socket = wsClient.connect(this.host + ':' + this.port, {'force new connection': true, 'reconnect': false});

  var self = this;
  this.socket.on('message', function(data, flags) {
    try {
//      if(flags.binary){
////        //console.log('ws rpc received message flags.binary, len = ', data.length);
//        zlib.gunzip(data, function (err, result) {
//          if(!!err){
//            console.warn('ws rpc received binary message error: %j', err.stack);
//            return;
//          }
//          //console.log("ws rpc client received message unzip len = " + result.length);
//          //console.log("ws rpc client received message unzip = " + result);
//          var msg = result;
//
//          msg = JSON.parse(msg);
//
//          if(msg.body instanceof Array) {
//            processMsgs(self, msg.body);
//          } else {
//            processMsg(self, msg.body);
//          }
//        });
//      }
//      else{
        //console.log("ws rpc client received message = " + data);
        var msg = data;

        msg = JSON.parse(msg);

        if(msg.body instanceof Array) {
          processMsgs(self, msg.body);
        } else {
          processMsg(self, msg.body);
        }
      //}
    } catch(e) {
      console.error('ws rpc client process message with error: %j', e.stack);
    }
  });

  this.socket.on('open', function() {
    if(self.connected) {
      //ignore reconnect
      return;
    }
    // success to connect
    self.connected = true;
    if(self.bufferMsg) {
      // start flush interval
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }
    self._KPinterval = setInterval(function() {
      checkKeepAlive(self);
    }, KEEP_ALIVE_INTERVAL);
    utils.invokeCallback(cb);
  });

  this.socket.on('error', function(err) {
    utils.invokeCallback(cb, err);
    self.close();
  });

  this.socket.on('close', function(code, message) {
    var reqs = self.requests, cb;
    for(var id in reqs) {
      cb = reqs[id];
      utils.invokeCallback(cb, new Error('disconnect with remote server.'));
    }
    self.emit('close', self.id);
    self.close();
  });

//  this.socket.on('ping', function (data, flags) {
//  });
  this.socket.on('pong', function (data, flags) {
    ////console.log('ws received pong: %s', data);
    self._KP_last_pong_time = Date.now();
  });

};

var checkKeepAlive = function(mailbox) {
  if(mailbox.closed) {
    return;
  }
  if(mailbox._KP_last_ping_time > 0){
    if(mailbox._KP_last_pong_time < mailbox._KP_last_ping_time ||
        mailbox._KP_last_pong_time - mailbox._KP_last_ping_time > KEEP_ALIVE_TIMEOUT){
      console.error('ws rpc client checkKeepAlive error');
      mailbox.close();
      return;
    }
  }
  mailbox.socket.ping();
  mailbox._KP_last_ping_time = Date.now();
};

/**
 * close mailbox
 */
pro.close = function() {
  if(this.closed) {
    return;
  }
  this.closed = true;
  if(this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  if(this._KPinterval) {
    clearInterval(this._KPinterval);
    this._KPinterval = null;
  }
  this.socket.close();
  this._KP_last_ping_time = -1;
  this._KP_last_pong_time = -1;
};

/**
 * send message to remote server
 *
 * @param msg {service:"", method:"", args:[]}
 * @param opts {} attach info to send method
 * @param cb declaration decided by remote interface
 */
pro.send = function(tracer, msg, opts, cb) {
  tracer.isEnabled = false;
  tracer.info('client', __filename, 'send', 'ws-mailbox try to send');
  if(!this.connected) {
    tracer.error('client', __filename, 'send', 'ws-mailbox not init');
    utils.invokeCallback(cb, tracer, new Error('not init.'));
    return;
  }

  if(this.closed) {
    tracer.error('client', __filename, 'send', 'mailbox alread closed');
    utils.invokeCallback(cb, tracer, new Error('mailbox alread closed.'));
    return;
  }

  var id = this.curId++;
  this.requests[id] = cb;
  setCbTimeout(this, id);

  var pkg;
  if(tracer.isEnabled) {
    pkg = {traceId: tracer.id, seqId: tracer.seq, source: tracer.source, remote: tracer.remote, id: id, msg: msg};
  }
  else {
    pkg = {id: id, msg: msg};
  }
  if(this.bufferMsg) {
    enqueue(this, pkg);
  } else {
    doSend(this.socket, pkg);
    //this.socket.send(JSON.stringify({body: pkg}));
  }
};

var enqueue = function(mailbox, msg) {
  mailbox.queue.push(msg);
};

var flush = function(mailbox) {
  if(mailbox.closed || !mailbox.queue.length) {
    return;
  }
  doSend(mailbox.socket, mailbox.queue);
  //mailbox.socket.send(JSON.stringify({body: mailbox.queue}));
  mailbox.queue = [];
};

var doSend = function(socket, dataObj) {
  var str = JSON.stringify({body: dataObj});
  //console.log("ws rpc client send str = " + str);
  //console.log("ws rpc client send str len = " + str.length);
  if(useZipCompress && str.length > DEFAULT_ZIP_LENGTH){//send zip binary
    process.nextTick(function(){
      zlib.gzip(str, function (err, result) {
        if(!!err){
          console.warn('ws rpc send message error: %j', err.stack);
          socket.send(str);
          return;
        }
//        console.log("ws rpc client send message by zip compress, buffer len = " + result.length);
        socket.send(result);
      });
    });
  }
  else{//send normal text
    //console.log("ws rpc client send message, len = " + str.length);
    socket.send(str);
  }
};

var processMsgs = function(mailbox, pkgs) {
  for(var i=0, l=pkgs.length; i<l; i++) {
    processMsg(mailbox, pkgs[i]);
  }
};

var processMsg = function(mailbox, pkg) {
  clearCbTimeout(mailbox, pkg.id);
  var cb = mailbox.requests[pkg.id];
  if(!cb) {
    return;
  }
  delete mailbox.requests[pkg.id];

  var tracer = new Tracer(mailbox.opts.rpcLogger, mailbox.opts.rpcDebugLog, mailbox.opts.clientId, pkg.source, pkg.resp, pkg.traceId, pkg.seqId);
  var args = [tracer, null];

  pkg.resp.forEach(function(arg){
    args.push(arg);
  });

  cb.apply(null, args);
};

var setCbTimeout = function(mailbox, id) {
  var timer = setTimeout(function() {
    logger.warn('rpc request is timeout, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
    clearCbTimeout(mailbox, id);
    if(!!mailbox.requests[id]) {
      delete mailbox.requests[id];
    }
    logger.error('rpc callback timeout, remote server host: %s, port: %s', mailbox.host, mailbox.port);
    utils.invokeCallback(cb, tracer, new Error('rpc callback timeout'));
  }, mailbox.timeoutValue);
  mailbox.timeout[id] = timer;
};

var clearCbTimeout = function(mailbox, id) {
  if(!mailbox.timeout[id]) {
    logger.warn('timer is not exsits, id: %s, host: %s, port: %s', id, mailbox.host, mailbox.port);
    return;
  }
  clearTimeout(mailbox.timeout[id]);
  delete mailbox.timeout[id];
};

/**
 * Factory method to create mailbox
 *
 * @param {Object} server remote server info {id:"", host:"", port:""}
 * @param {Object} opts construct parameters
 *                      opts.bufferMsg {Boolean} msg should be buffered or send immediately.
 *                      opts.interval {Boolean} msg queue flush interval if bufferMsg is true. default is 50 ms
 */
module.exports.create = function(server, opts) {
  return new MailBox(server, opts || {});
};