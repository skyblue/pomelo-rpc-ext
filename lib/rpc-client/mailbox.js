/**
 * Default mailbox factory
 */

//var Mailbox = require('./mailboxes/ws-mailbox');
//var Mailbox = require('./mailboxes/websocket-mailbox');
//var Mailbox = require('./mailboxes/tcp-mailbox');

/**
 * default mailbox factory
 *
 * @param {Object} serverInfo single server instance info, {id, host, port, ...}
 * @param {Object} opts construct parameters
 * @return {Object} mailbox instancef
 */
module.exports.create = function(serverInfo, opts) {
    opts.rpcType =  opts.rpcType || "sio";
    var Mailbox = require('./mailboxes/'+ opts.rpcType + '-mailbox');
    return Mailbox.create(serverInfo, opts);
};