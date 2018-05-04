var pkg = require('./package.json')
var config = require('yargs')
  .env('ZWAVE2MQTT')
  .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
  .describe('v', 'Verbosity level')
  .describe('n', 'instance name. used as mqtt client id and as prefix for connected topic')
  .describe('u', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
  .describe('d', 'device path')
  .describe('h', 'show help')
  .alias({
    'h': 'help',
    'n': 'name',
    'u': 'url',
    'd': 'device',
    'v': 'verbosity',
  })
  .default({
    'u': 'mqtt://127.0.0.1',
    'n': 'zwave',
    'v': 'info',
    'd': '/dev/ttyACM0'
  })
  .choices('v', ['error', 'warn', 'info', 'debug'])
  .wrap(80)
  // .config('config')
  .version()
  .help('help')
  .argv

module.exports = config
