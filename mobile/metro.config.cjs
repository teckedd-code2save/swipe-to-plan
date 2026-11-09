const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Domain modules are shared without moving the live web/backend packages.
config.watchFolders = [path.resolve(__dirname, '..', 'shared')];
module.exports = config;
