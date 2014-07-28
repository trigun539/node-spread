/**
 * Created from https://github.com/iwater work. Updated to work with the latest spread Daemon.
 */

var net = require('net');
var events = require('events');
var sys = require('sys');

/**
 * Create Spread connection
 * @param  {String} name            Name of the client connecting to spread
 * @param  {Number} Port            Port used for connection to Spread
 * @param  {String} Host            IP address or URL of Spread daemon
 * @param  {String} Default_Channel Group that the client will join on connection.
 * @return {EventEmitter}                 Event emitter
 */
exports.createConnection = function(name, Port, Host, Default_Channel){

  var emitter         = new events.EventEmitter;
  var state           = 'init';
  var resp            = '';
  var group           = '';
  var autoReconnect   = true;
  var header          = '';
  var str2            = '';
  var last            = '';
  var queue           = [];
  var unreliable_mess = String.fromCharCode(0x81,00,00,0x80);
  var reliable_mess   = String.fromCharCode(0x82,00,00,0x80);
  var fifo_mess       = String.fromCharCode(0x84,00,00,0x80);
  var causal_mess     = String.fromCharCode(0x88,00,00,0x80);
  var agreed_mess     = String.fromCharCode(0x90,00,00,0x80);
  var safe_mess       = String.fromCharCode(0xa0,00,00,0x80);
  var join_mess       = String.fromCharCode(0x80, 0x11, 0, 0x80);
  var count           = 0;
  var last_count      = 0;

  var client = net.createConnection(Port, Host);
  client.setEncoding('binary');
  client.setNoDelay();

  /**
   * Connecting to Spread
   * @return {Event} connect event is emitted through node emitter
   */
  client.on('connect', function(){
    emitter.emit('connect');

    var dataPackage = String.fromCharCode(0x04, 0x03, 0x00, 0x01, name.length) + name;
    client.write(dataPackage);
  });

  /**
   * Error in connection to spread
   * @param  {Object} error Provides error description.
   * @return {Event}       Emits error event with error information.
   */
  client.on('error', function(error){
    emitter.emit('error', error);
  });

  /**
   * Handler for when data is received from Spread
   * @param  {String} data Data sent from Spread
   * @return {Event}      Emits logon/logined/message events.
   */
  client.on('data', function(data){
    switch(state){
      case 'init':
        emitter.emit('logon', data);
      break;

      case 'logon':
        resp += data.toString('binary');
        if(resp.length > 5){
          group = resp.substr(5);
          resp = '';
          emitter.emit('logined', data);
        }
      break;

      case 'waiting':
        str2 += data;
        var length = 0;
        
        while(str2.length > 48 + length) {
          length = decodeInt32(str2, 44) + decodeInt32(str2, 36)*32;

          switch(str2.substr(0,4)){

            case unreliable_mess:
            case safe_mess:
            case reliable_mess:
            case fifo_mess:
            case agreed_mess:
            case causal_mess:
              if(str2.length >= 48 + length) {
                count++;
                var channel = str2.substr(48, 32).RTrim();
                var message = new Buffer(str2.substr(80, length - 32), 'binary').toString('utf8');
                str2 = str2.substr(48 + length);
                emitter.emit('message', channel, message);
              }
              break;

            case join_mess:
              if(str2.length >= 48 + length) {
                last = str2.substr(0, 48 + length);
                str2 = str2.substr(48 + length);
              }
              break;

            default:
              str2 = str2.substr(48 + length);
              break;
          }

          if(str2.length > 48) length = decodeInt32(str2, 44) + decodeInt32(str2, 36) * 32;
        }
      break;

      default:
        // Data received, but no handler.
      break;
      }
  });
  
  /**
   * Connection to Spread has closed.
   * @return {Event} Emits close event, returns state to init.
   */
  client.on('close', function(){
    emitter.emit('close');
    state = 'init';
    process.nextTick(function(){
      client.connect(Port, Host);
    });
  });

  /**
   * Logon
   * @param  {String} str Spread string
   */
  emitter.on('logon', function(str){
    state = 'logon';
    client.write('NULL'.r_pad(90));
  });

  /**
   * Client has authenticated with Spread
   * @param  {String} str Spread message
   */
  emitter.on('logined', function(str){
    state = 'logined';

    // Waiting 10s for other clients to connect to the server in order to receive messages
    setTimeout(function(){
      while(queue.length > 0){
        var msg = queue.shift();
        emitter.send(msg.channel, msg.msg);
      }
    }, 10000);
  });

  emitter.send = function(str, send_group){
    if(state == 'logined' || state == 'waiting'){
    var serviceType = unreliable_mess; 
    var privateGroup = group.r_pad(32);
    var numGroups = encodeInt32(1);
    var type = String.fromCharCode(0x80, 0x01, 0, 0x80);
    var groups = (send_group || Default_Channel).r_pad(32);

    client.write([serviceType, privateGroup, numGroups, type, encodeInt32(Buffer.byteLength(str)), groups].join(''), 'binary');
    client.write(str, 'utf8');
    } else {
      queue.push({channel:send_group, msg:str});
    }
  };

  emitter.join = function(join_group){
    state = 'waiting';
    var str = '';

    var serviceType = String.fromCharCode(0x80, 0x00, 0x01, 0x80);
    var privateGroup = group.r_pad(32);
    var numGroups = encodeInt32(1);
    var type = String.fromCharCode(0x80, 0, 0, 0x80);
    var groups = join_group.r_pad(32);

    client.write([serviceType, privateGroup, numGroups, type, encodeInt32(str.length), groups].join(''), 'binary');
    client.write(str, 'binary');
  };

  return emitter;
};

/**
 * UTILS
 */

String.prototype.r_pad = function(length){
  var chr = String.fromCharCode(0);
  var result = this;
  for (var i = result.length; i < length; i++) {
    result += chr;
  }
  return result;
};

var encodeInt32 = function(i){
  result = String.fromCharCode(i & 0xFF);
  result += String.fromCharCode(i >> 8 & 0xFF);
  result += String.fromCharCode(i >> 16 & 0xFF);
  result += String.fromCharCode(i >> 24 & 0xFF);
  return result;
};

var decodeInt32 = function(raw_packet, offset){
  return ((raw_packet.charCodeAt(offset + 3) * 16777216) +
      (raw_packet.charCodeAt(offset + 2) * 65536) +
      (raw_packet.charCodeAt(offset + 1) * 256) +
      raw_packet.charCodeAt(offset));
};

var rstr2hex = function(input){
    try {
        hexcase
    } 
    catch (e) {
        hexcase = 0;
    }
    var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
    var output = "";
    var x;
    for (var i = 0; i < input.length; i++) {
        x = input.charCodeAt(i);
        output += hex_tab.charAt((x >>> 4) & 0x0F) +
        hex_tab.charAt(x & 0x0F);
    }
    return output;
};

String.prototype.RTrim = function(){
    return this.replace(/[\x00]*$/g, '');
};