#!/usr/bin/env node

const pkg = require('./package.json')
const log = require('yalm')
const config = require('./config.js')
const mqtt = require('mqtt')
const ZwaveLib = require('openzwave-shared');

var mqttClient;
var zwave;
var zwaveid = null;
var zwaveconnected = false;
var devices = [];

// ToDo : load from file...
var nodemeta = {
  1: { name: 'Gateway', loc: 'KG-Waschkueche' },
  2: { name: 'Kellerlicht', loc: 'KG-Waschkueche' }
};

function start () {
  log.setLevel(config.verbosity)
  log.info(pkg.name + ' ' + pkg.version + ' starting')

  // MQTT Stuff
  // Define the will message (is send on disconnect).
  const mqttOptions = {
    will: {
      topic: config.name + '/connected',
      message: 0,
      qos: 0,
      retain: true
    }
  }

  mqttClient = mqtt.connect(config.url, mqttOptions)

  mqttClient.on('connect', () => {
    log.info('Connected to mqtt %s', config.url)
    mqttClient.subscribe(config.name + '/set/+/+')
    mqttClient.subscribe(config.name + '/cmd/+')
  })

  mqttClient.on('message', handleIncomingMessage)

  mqttClient.on('close', () => {
    log.info('mqtt closed ' + config.mqtt)
  })

  mqttClient.on('error', err => {
    log.error('mqtt', err.toString())
  })

  mqttClient.on('offline', () => {
    log.error('mqtt offline')
  })

  mqttClient.on('reconnect', () => {
    log.info('mqtt reconnect')
  })

  log.debug('Starting ZWave');
  zwave = new ZwaveLib({
    ConsoleOutput: true,
    Logging: false,
    SaveConfiguration: false,
    DriverMaxAttempts: 3,
    PollInterval: 500,
    SuppressValueRefresh: true,
//    UserPath: '/ozw/config',
//    ConfigPath: '/ozw/data'
  });
  zwave.connect(config.device);

  zwave.on('driver ready', function(homeid) {
    log.debug("zwave driver ready");
    zwaveid = homeid.toString(16);
  });

  zwave.on('driver failed', function() {
    log.debug("zwave driver failed");
    zwaveconnected = false;
    zwave.disconnect();
    publishConnectionStatus();
  });

  zwave.on('scan complete', function() {
    log.debug("zwave scan complete");
    zwaveconnected = true;
    publishConnectionStatus();
  });

  zwave.on('node added', function(nodeid) {
    log.debug("zwave node added: " + nodeid);
    if (!devices.hasOwnProperty(nodeid))
      devices[nodeid] = { state: 'added', values: {} };
    publishNode(nodeid);
  });

  zwave.on('node removed', function(nodeid) {
    log.debug("zwave node removeed: " + nodeid);
    devices[nodeid].state = 'removed';
    publishNode(nodeid);
    if (devices.hasOwnProperty(nodeid))
      delete devices[nodeid];
  });

  zwave.on('node naming', function(nodeid, nodeinfo) {
    log.debug("zwave node naming: " + nodeid + ": " + JSON.stringify(nodeinfo));
    Object.assign(devices[nodeid], nodeinfo);
    devices[nodeid].state = 'naming';
    publishNode(nodeid);
  });

  zwave.on('node available', function(nodeid, nodeinfo) {
    log.debug("zwave node available: " + nodeid + ": " + JSON.stringify(nodeinfo));
    Object.assign(devices[nodeid], nodeinfo);
    devices[nodeid].state = 'available';
    if (nodemeta.hasOwnProperty(nodeid)) {
      if (nodemeta[nodeid].hasOwnProperty('name'))
        if (nodemeta[nodeid].name != devices[nodeid].name)
          zwave.setNodeName(nodeid, nodemeta[nodeid].name);
      if (nodemeta[nodeid].hasOwnProperty('loc'))
        if (nodemeta[nodeid].loc != devices[nodeid].loc)
          zwave.setNodeLocation(nodeid, nodemeta[nodeid].loc);
    }
    publishNode(nodeid);
  });

  zwave.on('node ready', function(nodeid, nodeinfo){
    log.debug("zwave node ready: " + nodeid + ": " + JSON.stringify(nodeinfo));
    Object.assign(devices[nodeid], nodeinfo);
    devices[nodeid].state = 'ready';
    publishNode(nodeid);
  });

  zwave.on('node event', function(nodeid, data) {
    log.debug("zwave node event: " + nodeid + ": " + JSON.stringify(data));
    // ToDo
  });

  zwave.on('value added', function(nodeid, commandclass, valueId) {
    log.debug("zwave value added: " + nodeid + " / " + commandclass + " / " + JSON.stringify(valueId));
    if (!devices[nodeid].hasOwnProperty(valueId.value_id))
      devices[nodeid].values[valueId.value_id] = valueId;
    else
      Object.assign(devices[nodeid].values[valueId.value_id], valueId);
    publishValue(valueId.value_id);
  });

  zwave.on('value changed', function(nodeid, commandclass, valueId) {
    log.debug("zwave value changed: " + nodeid + " / " + commandclass + " / " + JSON.stringify(valueId));
    if (!devices[nodeid].values.hasOwnProperty(valueId.value_id))
      devices[nodeid].values[valueId.value_id] = valueId;
    else
      Object.assign(devices[nodeid].values[valueId.value_id], valueId);
    publishValue(valueId.value_id);
  });

  zwave.on('value removed', function(nodeid, commandclass, instance, index) {
    log.debug("zwave value removed: " + nodeid + " / " + commandclass + " / " + instance + "/" + index);
    var valueid = nodeid + '-' + commandclass + '-' + instance + '-' + index;
    if (devices[nodeid].values.hasOwnProperty(valueid))
      delete devices[nodeid].values[valueid];
  });

  zwave.on('controller command', function(nodeid, ctrlState, ctrlError, helpmsg){
    log.debug("zwave controller command: " + nodeid + ": " + ctrlState + " / " + ctrlError + " / " + helpmsg);
    // ToDo
  });
}

// This function will receive all incoming messages from MQTT
async function handleIncomingMessage (topic, payload) {
  payload = payload.toString()
  log.debug('Incoming message to %s %j', topic, payload)
  const parts = topic.toLowerCase().split('/')
  // Commands for devices
  if (parts[1] === 'set' && parts.length === 4) {
    return handleDeviceCommand(parts[3], payload)
      .then(result => {
        log.debug('Executed %s result: %j', parts[3], result)
      })
      .catch(err => {
        log.error('Error executing %s %j', parts[3], err)
      });
  } else if (parts[1] === 'cmd' && parts.length === 3) {
    return handleControllerCommand(parts[2], payload)
      .then(result => {
        log.debug('Executed %s result: %j', parts[2], result)
      })
      .catch(err => {
        log.error('Error executing %s %j', parts[2], err)
      })
  }
}

async function handleControllerCommand (cmd, payload) {
  log.debug('executing device command', cmd, payload);
  switch (cmd) {
    case "scan":
      zwave.addNode(zwaveid, true);
      break;
  }
}

async function handleDeviceCommand (address, payload) {
  log.debug('executing device command', address, payload);
  var val = JSON.parse(payload).val;
  var parts = address.split('-');
  log.debug('executing device command', address, val);
  zwave.setValue(parseInt(parts[0].trim()), parseInt(parts[1].trim()), parseInt(parts[2].trim()), parseInt(parts[3].trim()), val);
}

function publishConnectionStatus () {
  let status = '1'
  if (zwaveconnected) { status = '2' }
  mqttClient.publish(config.name + '/connected', status, {
    qos: 0,
    retain: true
  })
}

function publishNode (nodeid) {
  mqttClient.publish(config.name + '/status/' + nodeid + '/state', devices[nodeid].state, true);
  if (devices[nodeid].name && devices[nodeid].name.length > 0)
    mqttClient.publish(config.name + '/status/' + nodeid + '/name', devices[nodeid].name, true);
}

function publishValue (valueid) {
  var nodeid = valueid.split('-')[0];
  var topic = config.name + '/status/' + nodeid + '/' + valueid;
  var value = devices[nodeid].values[valueid].value;
  if (value != null) {
    if (mqttClient.connected) {
      let data = {
        ts: new Date().getTime(),
        val: value
      };
      var uom = devices[nodeid].values[valueid].units;
      if (uom && uom.length > 0)
        data.uom = uom;
      var label = devices[nodeid].values[valueid].label;
      if (label && label.length > 0 && label != "Unknown")
        data.label = label;
      mqttClient.publish(topic, JSON.stringify(data), true);
      log.debug('Published to %s', topic)
    } else {
      log.debug('Couldn\'t publish to %s because not connected', topic)
    }
  }
}

start()
