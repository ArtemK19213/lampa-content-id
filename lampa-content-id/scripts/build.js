'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const modules = ['transport', 'catalog', 'hls', 'view', 'screen', 'main'];
const sources = modules.map(function (name) {
    const code = fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
    return JSON.stringify('./' + name) + ': function (module, require) {\n' + code + '}';
});
const style = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
sources.push('"./style": function (module) { module.exports = ' + JSON.stringify(style) + '; }');
const bundle = [
    '/*! Видео по ID · v' + version + ' · built by scripts/build.js */',
    '(function (window) {',
    "'use strict';",
    'var modules = {\n' + sources.join(',\n') + '\n};',
    'var cache = {};',
    'function require(name) {',
    '    if (!cache[name]) {',
    '        var module = cache[name] = { exports: {} };',
    '        modules[name](module, require);',
    '    }',
    '    return cache[name].exports;',
    '}',
    "require('./main')(window);",
    '}(window));',
    ''
].join('\n');

const output = path.join(root, 'docs', 'lampa-content-id.js');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, bundle);
console.log('docs/lampa-content-id.js — ' + Buffer.byteLength(bundle) + ' B');
