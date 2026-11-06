'use strict';

function attributes(line) {
    var values = {};
    var pattern = /(?:^|,)\s*([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^,]*))/gi;
    var match;
    while ((match = pattern.exec(line))) {
        values[match[1].toUpperCase()] = (match[2] === undefined ? match[3] : match[2]).trim();
    }
    return values;
}

function parsePlaylist(text, base, resolveHttps) {
    var lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines[0].trim() !== '#EXTM3U') throw new Error('Ожидался плейлист HLS.');

    var master = false;
    var media = false;
    var groups = {};
    var streams = [];
    var pending = null;

    lines.slice(1).forEach(function (line) {
        line = line.trim();
        if (!line) return;

        if (line.indexOf('#EXT-X-MEDIA:') === 0) {
            var rendition = attributes(line.slice(13));
            if (rendition.URI && rendition['GROUP-ID']) {
                groups[rendition.TYPE + ':' + rendition['GROUP-ID']] = true;
            }
        }

        if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
            master = true;
            pending = attributes(line.slice(18));
        } else if (/^#EXT/.test(line)) {
            if (/^#(?:EXTINF:|EXT-X-TARGETDURATION:|EXT-X-PART:)/.test(line)) media = true;
            pending = null;
        } else if (pending && line.charAt(0) !== '#') {
            var uri = resolveHttps(line, base);
            var size = /^(\d+)x(\d+)$/i.exec(pending.RESOLUTION || '');
            if (uri) {
                streams.push({
                    url: uri,
                    height: size && Number(size[1]) > 0 ? Number(size[2]) : 0,
                    bandwidth: Number(pending['AVERAGE-BANDWIDTH'] || pending.BANDWIDTH) || 0,
                    audio: pending.AUDIO,
                    video: pending.VIDEO
                });
            }
            pending = null;
        }
    });

    if (!master && media) return { kind: 'media', variants: [] };
    if (!master || !streams.length) throw new Error('Плейлист HLS не содержит подходящих потоков.');

    var external = streams.some(function (stream) {
        return groups['AUDIO:' + stream.audio] || groups['VIDEO:' + stream.video];
    });
    if (external) return { kind: 'adaptive', variants: [] };

    var seen = {};
    var variants = streams.sort(function (a, b) {
        return b.height - a.height || b.bandwidth - a.bandwidth;
    }).filter(function (stream) {
        if (!isFinite(stream.height) || stream.height < 1 || seen[stream.height]) return false;
        seen[stream.height] = true;
        return true;
    });

    return { kind: variants.length ? 'levels' : 'adaptive', variants: variants };
}

function resolvePlayback(stream, preferred) {
    var manual = stream.variants.filter(function (item) {
        return String(item.height) === preferred;
    })[0];
    var selected = manual || stream.variants[0];
    return {
        url: selected ? selected.url : stream.source,
        quality: manual ? preferred : 'auto',
        height: selected ? selected.height : 0
    };
}

function createStreamInspector(browser, get, resolveHttps) {
    return function inspect(url, done) {
        var path = url.split(/[?#]/, 1)[0];
        if (!/\.m3u8$/i.test(path)) {
            var timer = browser.setTimeout(function () {
                done({ source: url, kind: /\.mp4$/i.test(path) ? 'mp4' : 'direct', variants: [] });
            }, 0);
            return function cancel() { browser.clearTimeout(timer); };
        }

        return get(url, function (error, response) {
            var stream;
            if (!error) {
                try {
                    stream = parsePlaylist(response.text, response.url, resolveHttps);
                } catch (parseError) {
                    error = parseError;
                }
            }
            if (error) stream = { kind: 'fallback', variants: [], reason: error.message };
            stream.source = url;
            done(stream);
        });
    };
}

module.exports = {
    parsePlaylist: parsePlaylist,
    resolvePlayback: resolvePlayback,
    createStreamInspector: createStreamInspector
};
