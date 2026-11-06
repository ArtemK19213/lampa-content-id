'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/catalog');
const hls = require('../src/hls');
const { createUrlResolver, createTransport } = require('../src/transport');

const browser = { URL, setTimeout, clearTimeout };
const resolve = createUrlResolver(browser);
const origin = 'https://media.example.test';
const base = origin + '/redirected/movies/master.m3u8?main=1';

function voice(id, name, studio, url = origin + '/master.m3u8') {
    return { id, title: name, dubbingStudioId: studio, filepath: url, streamQuality: 'WEB_DL' };
}

function episode(id, season, order, ...variants) {
    return { id, season: { order: season }, order, episodeVariants: variants };
}

test('accepts a numeric content ID and keeps it as a string', () => {
    assert.equal(catalog.contentId(' 00144537 '), '144537');
    assert.equal(catalog.contentId('12345678901234567890'), '12345678901234567890');
    for (const value of ['000', '-1', '12.3', '1&x=2', '', 'https://example.com/144537']) {
        assert.equal(catalog.contentId(value), '');
    }
});

test('sorts seasons and episodes, and uses only usable options returned by the source', () => {
    const data = catalog.normalize([
        episode(4, 2, 1, voice(5, 'Оригинал', null)),
        episode(3, 1, 12, voice(4, 'Студия А', 7)),
        episode(1, 1, 2, voice(2, 'Оригинал', null), voice(3, 'Студия А', 7)),
        episode(2, 1, 3, voice(9, 'Повреждённый вариант', 3, 'javascript:alert(1)'))
    ], resolve);
    assert.deepEqual(data.seasons.map(season => season.order), [1, 2]);
    assert.deepEqual(data.episodes.map(entry => entry.key), ['id:1', 'id:2', 'id:3', 'id:4']);
    assert.equal(data.episodes[1].variants.length, 0);
    assert.equal(catalog.chooseVariant(data.episodes[0]).name, 'Оригинал');
    assert.equal(catalog.chooseVariant(data.episodes[0], { voice: 'studio:7', name: 'Студия А' }).name, 'Студия А');
    assert.equal(catalog.chooseVariant(data.episodes[3], { voice: 'studio:7', name: 'Студия А' }).name, 'Оригинал');
    assert.equal(catalog.findEpisode(data, { key: 'old-id', season: 2, order: 1 }), data.episodes[3]);
});

test('supports a single unseasoned video in the verified schema', () => {
    const data = catalog.normalize([{ title: 'Тестовый фильм', episodeVariants: [voice(1, 'Оригинал')] }], resolve);
    assert.equal(data.single, true);
    assert.equal(catalog.episodeLabel(data.episodes[0], true), 'Тестовый фильм');
    assert.throws(() => catalog.normalize({ episodes: [] }, resolve));
    assert.deepEqual(catalog.normalize([], resolve).episodes, []);
});

test('lists real heights in order and uses the redirected playlist URL as base', () => {
    const parsed = hls.parsePlaylist([
        '\uFEFF#EXTM3U',
        '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,RESOLUTION=3840x2160,URI="i.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
        '../720p/low.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=854x480',
        './480p/media.m3u8?q=a%2Fb',
        '#EXT-X-STREAM-INF:BANDWIDTH=2300000,RESOLUTION=1280x720',
        '/720p/high.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080',
        '//edge.example.test/1080p/media.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=128000',
        'audio.m3u8'
    ].join('\r\n'), base, resolve);
    assert.deepEqual(parsed.variants.map(item => item.height), [1080, 720, 480]);
    const stream = { ...parsed, source: base };
    assert.equal(hls.resolvePlayback(stream, 'auto').url, 'https://edge.example.test/1080p/media.m3u8');
    assert.equal(hls.resolvePlayback(stream, '480').url, origin + '/redirected/movies/480p/media.m3u8?q=a%2Fb');
    assert.equal(hls.resolvePlayback(stream, '720').url, origin + '/720p/high.m3u8');
    assert.equal(hls.resolvePlayback(stream, '2160').quality, 'auto');
    assert.equal(hls.resolvePlayback(stream, '2160').height, 1080);
});

test('keeps the master playlist when a rendition needs a separate audio track', () => {
    const parsed = hls.parsePlaylist([
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO="ru"',
        'video/720.m3u8',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ru",NAME="Русская, стерео",URI="audio.m3u8"'
    ].join('\n'), base, resolve);
    assert.equal(parsed.kind, 'adaptive');
    assert.deepEqual(parsed.variants, []);
    assert.equal(hls.resolvePlayback({ ...parsed, source: base }, '720').url, base);
});

test('media playlists and unknown height do not get invented quality labels', () => {
    assert.equal(hls.parsePlaylist('#EXTM3U\n#EXTINF:5,\nfile.ts', base, resolve).kind, 'media');
    assert.equal(hls.parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant.m3u8', base, resolve).kind, 'adaptive');
    assert.throws(() => hls.parsePlaylist('<html>Forbidden</html>', base, resolve));
    assert.throws(() => hls.parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123', base, resolve));
    assert.equal(resolve('http://example.com/file.mp4'), '');
    assert.equal(resolve('https://user@example.com/file.mp4'), '');
    assert.equal(resolve('data:text/html,hello', base), '');
});

test('MP4 is direct and a failed manifest falls back to the fresh source URL', async () => {
    const requests = [];
    const inspect = hls.createStreamInspector(browser, (url, done) => {
        requests.push(url);
        const timer = setTimeout(() => done(new Error('CORS simulated')), 0);
        return () => clearTimeout(timer);
    }, resolve);

    const mp4 = await new Promise(done => inspect(origin + '/a.MP4?v=1', done));
    assert.equal(mp4.kind, 'mp4');
    assert.equal(hls.resolvePlayback(mp4, 'auto').url, origin + '/a.MP4?v=1');
    assert.equal(requests.length, 0);
    const failure = await new Promise(done => inspect(base, done));
    assert.deepEqual(requests, [base]);
    assert.equal(failure.kind, 'fallback');
    assert.equal(hls.resolvePlayback(failure, '1080').height, 0);
    assert.equal(hls.resolvePlayback(failure, '1080').url, base);
});

test('Fetch requests fresh data, omits credentials, and ignores a cancelled result', async () => {
    let pending;
    let options;
    const get = createTransport({
        ...browser,
        AbortController,
        fetch(_url, supplied) {
            options = supplied;
            return new Promise(resolve => { pending = resolve; });
        }
    });
    let received = false;
    const cancel = get(base, () => { received = true; });
    cancel();
    pending({ ok: true, status: 200, text: async () => '#EXTM3U', url: base });
    await new Promise(done => setTimeout(done, 0));
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.signal.aborted, true);
    assert.equal(received, false);
});

test('XMLHttpRequest fallback uses responseURL for the final address', async () => {
    class Xhr {
        open(method, url, async) {
            assert.equal(method, 'GET');
            assert.equal(url, origin + '/master.m3u8');
            assert.equal(async, true);
        }
        send() {
            setTimeout(() => {
                this.status = 200;
                this.responseText = '#EXTM3U';
                this.responseURL = base;
                this.onload();
            }, 0);
        }
    }
    const get = createTransport({ ...browser, XMLHttpRequest: Xhr });
    const received = await new Promise((resolve, reject) => get(origin + '/master.m3u8', (error, result) => {
        if (error) reject(error);
        else resolve(result);
    }));
    assert.deepEqual(received, { text: '#EXTM3U', url: base });
});
