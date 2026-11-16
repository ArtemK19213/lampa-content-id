/*! Видео по ID · v1.0.0 · built by scripts/build.js */
(function (window) {
'use strict';
var modules = {
"./transport": function (module, require) {
'use strict';

function transportError(message, status) {
    var error = new Error(message);
    error.status = status || 0;
    return error;
}

function createTransport(browser) {
    return function get(url, done) {
        var complete = false;
        var xhr;
        var aborter;
        var timer = browser.setTimeout(function () {
            finish(transportError('Источник не ответил вовремя.'));
            abort();
        }, 12000);

        function abort() {
            if (aborter) aborter.abort();
            if (xhr) xhr.abort();
        }

        function finish(error, result) {
            if (complete) return;
            complete = true;
            browser.clearTimeout(timer);
            done(error, result);
        }

        function receive(status, body, finalUrl) {
            if (status < 200 || status >= 300) {
                finish(transportError('Источник вернул HTTP ' + status + '.', status));
                return;
            }
            finish(null, { text: body, url: finalUrl || url });
        }

        function networkError() {
            finish(transportError('Нет ответа от источника. Проверьте соединение и доступ из этой версии Lampa.'));
        }

        function getWithXhr() {
            xhr = new browser.XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = function () {
                if (!xhr.status) networkError();
                else receive(xhr.status, xhr.responseText, xhr.responseURL);
            };
            xhr.onerror = networkError;
            xhr.send();
        }

        try {
            if (typeof browser.fetch === 'function') {
                var options = { cache: 'no-store', credentials: 'omit' };
                if (typeof browser.AbortController === 'function') {
                    aborter = new browser.AbortController();
                    options.signal = aborter.signal;
                }

                browser.fetch(url, options).then(function (response) {
                    if (!response.ok) {
                        receive(response.status);
                        return;
                    }
                    return response.text().then(function (body) {
                        receive(response.status, body, response.url);
                    });
                }, networkError).then(null, networkError);
            } else {
                getWithXhr();
            }
        } catch (error) {
            browser.setTimeout(networkError, 0);
        }

        return function cancel() {
            if (complete) return;
            complete = true;
            browser.clearTimeout(timer);
            abort();
        };
    };
}

function createUrlResolver(browser) {
    return function resolveHttps(uri, base) {
        if (typeof uri !== 'string') return '';
        uri = uri.trim();
        if (!uri || /[\x00-\x20\x7f\\]/.test(uri)) return '';
        if (!base && !/^https:\/\//i.test(uri)) return '';

        var parsed;
        try {
            parsed = base ? new browser.URL(uri, base) : new browser.URL(uri);
        } catch (error) {
            // Some TV webviews expose URL only for createObjectURL.
            if (!browser.document || !browser.document.implementation) return '';
            try {
                var doc = browser.document.implementation.createHTMLDocument('');
                if (base) {
                    var baseTag = doc.createElement('base');
                    baseTag.href = base;
                    doc.head.appendChild(baseTag);
                }
                parsed = doc.createElement('a');
                parsed.href = uri;
            } catch (fallbackError) {
                return '';
            }
        }

        if (parsed.protocol !== 'https:' || !parsed.hostname || /^https:\/\/[^/?#]*@/i.test(parsed.href)) return '';
        return parsed.href;
    };
}

module.exports = { createTransport: createTransport, createUrlResolver: createUrlResolver };
},
"./catalog": function (module, require) {
'use strict';

var ENDPOINT = 'https://player.shortener2.link/balancer-api/proxy/playlists/catalog-api/episodes?content-id=';

function contentId(value) {
    var text = typeof value === 'string' ? value.trim() : '';
    if (!/^\d{1,32}$/.test(text)) return '';
    return text.replace(/^0+/, '');
}

function numberOrder(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^\d+$/.test(String(value))) return null;
    var number = Number(value);
    return isFinite(number) && number <= 9007199254740991 ? number : null;
}

function label(value) {
    return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function identifier(value) {
    return typeof value === 'number' && isFinite(value) ? String(value) : label(value);
}

function normalize(rows, resolveHttps) {
    if (!Array.isArray(rows)) throw new Error('Источник вернул данные в неизвестном формате.');

    var episodes = [];
    var seen = {};
    rows.forEach(function (row, index) {
        if (!row || !Array.isArray(row.episodeVariants)) return;

        var season = row.season ? numberOrder(row.season.order) : null;
        var order = numberOrder(row.order);
        var id = identifier(row.id);
        var key = id ? 'id:' + id : 'position:' + season + ':' + order + ':' + index;
        if (seen[key]) return;
        seen[key] = true;

        var variants = [];
        row.episodeVariants.forEach(function (variant, variantIndex) {
            if (!variant) return;
            var url = resolveHttps(variant.filepath);
            if (!url) return;

            var name = label(variant.title);
            var studio = identifier(variant.dubbingStudioId);
            variants.push({
                key: (identifier(variant.id) || 'variant') + ':' + variantIndex,
                voice: studio ? 'studio:' + studio : name ? 'name:' + name.toLowerCase() : '',
                name: name || 'Вариант ' + (variantIndex + 1),
                named: Boolean(name),
                url: url
            });
        });

        episodes.push({
            key: key,
            season: season,
            order: order === null ? index + 1 : order,
            title: label(row.title) || label(row.originalTitle),
            variants: variants
        });
    });

    episodes.sort(function (a, b) {
        var first = a.season === null ? Infinity : a.season;
        var second = b.season === null ? Infinity : b.season;
        return first === second ? a.order - b.order : first - second;
    });

    var seasons = [];
    episodes.forEach(function (episode) {
        var last = seasons[seasons.length - 1];
        if (!last || last.order !== episode.season) {
            last = { order: episode.season, episodes: [] };
            seasons.push(last);
        }
        last.episodes.push(episode);
    });

    return { episodes: episodes, seasons: seasons, single: episodes.length === 1 && episodes[0].season === null };
}

function seasonLabel(order) {
    if (order === null) return 'Без сезона';
    if (order === 0) return 'Спецвыпуски';
    return 'Сезон ' + order;
}

function episodeLabel(episode, single) {
    if (single) return episode.title || 'Видео';
    var name = 'Серия ' + episode.order;
    return episode.title && episode.title.toLowerCase() !== name.toLowerCase() ? name + ' · ' + episode.title : name;
}

function findEpisode(data, selection) {
    if (!selection) return null;
    return data.episodes.filter(function (episode) {
        return episode.key === selection.key;
    })[0] || data.episodes.filter(function (episode) {
        return episode.season === selection.season && episode.order === selection.order;
    })[0] || null;
}

function chooseVariant(episode, preference) {
    if (!episode) return null;
    var variants = episode.variants;
    if (preference) {
        var matched = variants.filter(function (variant) {
            return episode.key === preference.episode && variant.key === preference.key &&
                variant.voice === preference.voice && variant.name === preference.name;
        })[0] || variants.filter(function (variant) {
            return variant.voice && variant.voice === preference.voice && variant.name === preference.name;
        })[0] || variants.filter(function (variant) {
            return variant.voice && variant.voice === preference.voice;
        })[0] || variants.filter(function (variant) {
            return variant.named && variant.name === preference.name;
        })[0];
        if (matched) return matched;
    }
    return variants[0] || null;
}

function createCatalog(get, resolveHttps) {
    return {
        load: function (id, done) {
            return get(ENDPOINT + encodeURIComponent(id), function (error, response) {
                if (error) {
                    done(error);
                    return;
                }
                var data;
                try {
                    data = normalize(JSON.parse(response.text), resolveHttps);
                } catch (parseError) {
                    done(new Error('Источник вернул данные в неизвестном формате.'));
                    return;
                }
                done(null, data);
            });
        }
    };
}

module.exports = {
    contentId: contentId,
    normalize: normalize,
    seasonLabel: seasonLabel,
    episodeLabel: episodeLabel,
    findEpisode: findEpisode,
    chooseVariant: chooseVariant,
    createCatalog: createCatalog
};
},
"./hls": function (module, require) {
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
},
"./view": function (module, require) {
'use strict';

function createView($, browser, controller, onAction) {
    var root = $('<div class="lci layer--wheight"></div>');
    var panel = $('<div class="lci-panel"></div>').appendTo(root);
    var eyebrow = $('<div class="lci-eyebrow">ПРОСМОТР ПО CONTENT-ID</div>').appendTo(panel);
    var heading = $('<h2 class="lci-title"></h2>').appendTo(panel);
    var subtitle = $('<p class="lci-subtitle"></p>').appendTo(panel);
    var controls = $('<div class="lci-controls"></div>').appendTo(panel);
    var status = $('<p class="lci-status" role="status" aria-live="polite"></p>').appendTo(panel);
    var nodes = {};
    var grid = [];
    var key = 'id';
    var column = 0;

    function mark(next) {
        if (nodes[key]) nodes[key].removeClass('lci-active');
        key = next;
        nodes[key].addClass('lci-active');
    }

    function scrollTo(node) {
        var viewport = root[0].getBoundingClientRect();
        var item = node.getBoundingClientRect();
        if (item.bottom > viewport.bottom - 8) root[0].scrollTop += item.bottom - viewport.bottom + 8;
        if (item.top < viewport.top + 8) root[0].scrollTop -= viewport.top + 8 - item.top;
    }

    function focus(next) {
        if (!nodes[next]) next = nodes.play ? 'play' : 'id';
        if (!nodes[next]) return;

        mark(next);
        controller.collectionFocus(nodes[next][0], root);
        scrollTo(nodes[next][0]);
    }

    function addTile(row, item, index) {
        var tile = $('<div class="lci-tile" role="button"></div>').attr('data-lci-key', item.key).appendTo(row);
        if (item.caption) $('<div class="lci-caption"></div>').text(item.caption).appendTo(tile);
        $('<div class="lci-value"></div>').text(item.value).appendTo(tile);

        if (item.key === 'play') tile.addClass('lci-play');
        if (item.enabled === false) {
            tile.addClass('lci-disabled').attr('aria-disabled', 'true');
            return;
        }

        nodes[item.key] = tile.addClass('selector');
        if (item.choice) $('<span class="lci-choice" aria-hidden="true">›</span>').appendTo(tile);
        tile.on('hover:focus hover:hover', function () { mark(item.key); });
        var enter = function () {
            column = index;
            mark(item.key);
            onAction(item.key);
        };
        tile.on('hover:enter', enter);
        if (!browser.MutationObserver) tile.on('click', enter);
    }

    function render(model) {
        nodes = {};
        controls.empty();
        eyebrow.toggleClass('lci-has-id', !!model.contentId);
        heading.text(model.title);
        subtitle.text(model.subtitle);
        status.text(model.status).toggleClass('lci-status-error', !!model.error);

        grid = model.rows.map(function (items) {
            var row = $('<div class="lci-row"></div>').appendTo(controls);
            items.forEach(function (item, index) { addTile(row, item, index); });
            return items.map(function (item) { return item.enabled === false ? '' : item.key; });
        });
    }

    function restore(next) {
        controller.collectionSet(root);
        focus(next || key);
    }

    function move(direction) {
        var row = -1;
        var index = -1;
        grid.some(function (items, i) {
            index = items.indexOf(key);
            if (index === -1) return false;
            row = i;
            return true;
        });
        if (row === -1) return false;

        if (direction === 'left' || direction === 'right') {
            var target = index + (direction === 'left' ? -1 : 1);
            if (!grid[row][target]) return false;
            column = target;
            focus(grid[row][target]);
            return true;
        }

        var step = direction === 'up' ? -1 : 1;
        for (row += step; row >= 0 && row < grid.length; row += step) {
            var next = grid[row][column] || grid[row][0] || grid[row][1];
            if (next) {
                focus(next);
                return true;
            }
        }
        return false;
    }

    return {
        root: root,
        render: render,
        restore: restore,
        move: move,
        key: function () { return key; },
        enter: function () { if (nodes[key]) onAction(key); }
    };
}

module.exports = createView;
},
"./screen": function (module, require) {
'use strict';

var catalogModel = require('./catalog');
var resolvePlayback = require('./hls').resolvePlayback;
var createView = require('./view');
var STATE_KEY = 'lampa-content-id:v1';

function readState(browser) {
    try {
        var state = JSON.parse(browser.localStorage.getItem(STATE_KEY));
        if (state && typeof state === 'object' && !Array.isArray(state)) return state;
    } catch (error) {
        // The screen can still be used in a webview with storage disabled.
    }
    return {};
}

function writeState(browser, state) {
    try {
        browser.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) {}
}

function selectTitle(value) {
    // Lampa's default Select template takes HTML. The panel itself uses text nodes.
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function item(value, title, selected) {
    return { value: value, title: selectTitle(title), selected: selected };
}

function tile(key, caption, value, enabled, choice) {
    return { key: key, caption: caption, value: value, enabled: enabled, choice: choice };
}

function makeComponent(browser, $, Lampa, catalog, inspect, titleForId) {
    return function ContentById(activity) {
        var controller = Lampa.Controller;
        var prefs = readState(browser);
        var draft = catalogModel.contentId(activity.contentId) || catalogModel.contentId(prefs.enteredId) ||
            catalogModel.contentId(prefs.lastId);
        var loadedId = '';
        var data;
        var episode;
        var variant;
        var stream;
        var request;
        var message = '';
        var warning = false;
        var destroyed = false;
        var started = false;
        var focusOnToggle;
        var view = createView($, browser, controller, function (key) { actions[key](); });

        function current() {
            return !destroyed && Lampa.Activity.active() === activity;
        }

        function inPanel() {
            return current() && controller.enabled().controller === controls;
        }

        function qualityPreference() {
            return typeof prefs.quality === 'string' && /^\d+$/.test(prefs.quality) ? prefs.quality : 'auto';
        }

        function title() {
            return (activity.contentId === loadedId && activity.contentTitle) || titleForId(loadedId) ||
                (data && data.single && episode && episode.title) ||
                (loadedId ? 'content-id ' + loadedId : 'Видео по ID');
        }

        function episodeTitle(entry) {
            return catalogModel.episodeLabel(entry, data.single);
        }

        function qualityLabel() {
            if (!stream) return '—';
            if (stream.kind === 'mp4') return 'Источник · MP4';
            if (stream.kind === 'adaptive') return 'Выбор плеера · HLS';
            if (!stream.variants.length) return stream.kind === 'direct' ? 'Как у источника' : 'Источник · HLS';

            var playback = resolvePlayback(stream, qualityPreference());
            return (playback.quality === 'auto' ? 'Авто · ' : '') + playback.height + 'p';
        }

        function status() {
            if (request && request.kind === 'catalog') return 'Загружаем список видео…';
            if (request && request.kind === 'play') return 'Обновляем ссылку для воспроизведения…';
            if (message) return message;
            if (!loadedId) return 'Введите ID видеоплеера. Например, 144537.';
            if (!episode) return '';
            if (!variant) return 'Для выбранного видео источник не вернул ссылку.';
            if (!stream) return 'Проверяем доступное качество…';
            if (stream.kind === 'fallback') return stream.reason + ' Плеер попробует открыть исходную ссылку HLS.';
            if (stream.kind === 'adaptive') return 'Плеер выберет качество по плейлисту HLS.';
            if (stream.variants.length && qualityPreference() !== 'auto' &&
                resolvePlayback(stream, qualityPreference()).quality === 'auto') {
                return qualityPreference() + 'p недоступно для этого варианта. Сейчас выбрано авто.';
            }
            if (stream.kind === 'mp4') return 'Источник прислал один файл MP4.';
            return '';
        }

        function draw(focus) {
            var position = episode ? data.episodes.indexOf(episode) : -1;
            var subtitle = data && data.episodes.length ?
                (data.single ? 'Одиночное видео' : 'Сезонов — ' + data.seasons.length + ' · Серий — ' + data.episodes.length) :
                'Введите ID, чтобы открыть список видео';
            var rows = [[
                tile('id', 'ID видеоплеера', draft || 'Ввести ID', true, true),
                tile('load', '', 'Загрузить')
            ]];
            if (episode) {
                if (!data.single) {
                    rows.push([
                        tile('season', 'Сезон', catalogModel.seasonLabel(episode.season), true, true),
                        tile('episode', 'Серия', episodeTitle(episode), true, true)
                    ]);
                }
                var levels = !!(stream && stream.variants.length);
                rows.push([
                    tile('voice', 'Озвучка', variant ? variant.name : '—', !!variant, !!variant),
                    tile('quality', 'Качество', qualityLabel(), levels, levels)
                ], [
                    tile('play', '', 'Воспроизвести', !!variant)
                ]);
                if (!data.single) {
                    rows.push([
                        tile('prev', '', 'Предыдущая серия', position > 0),
                        tile('next', '', 'Следующая серия', position < data.episodes.length - 1)
                    ]);
                }
            }

            view.render({
                contentId: loadedId,
                title: title(),
                subtitle: subtitle,
                rows: rows,
                status: status(),
                error: warning || !!(stream && stream.kind === 'fallback')
            });
            if (inPanel()) view.restore(focus);
        }

        function setMessage(text, error) {
            message = text;
            warning = Boolean(error);
        }

        function stopRequest() {
            if (!request) return;
            if (request.cancel) request.cancel();
            request = null;
        }

        function begin(kind) {
            stopRequest();
            request = { kind: kind };
            return request;
        }

        function listen(job, task, done) {
            job.cancel = task(function (error, result) {
                if (!current() || request !== job) return;
                job.cancel = null;
                done(error, result);
            });
        }

        function inspectVariant(job, chosen, done) {
            listen(job, function (callback) {
                return inspect(chosen.url, function (result) { callback(null, result); });
            }, function (error, result) { done(result); });
        }

        function persist() {
            if (!loadedId) return;
            prefs.lastId = loadedId;
            if (episode) prefs.position = { key: episode.key, season: episode.season, order: episode.order };
            writeState(browser, prefs);
        }

        function setEpisode(entry) {
            episode = entry;
            variant = catalogModel.chooseVariant(episode, prefs.voice);
        }

        function readQuality(focus) {
            stopRequest();
            stream = null;
            draw(focus);
            if (!variant) return;
            var job = begin('inspect');
            inspectVariant(job, variant, function (result) {
                request = null;
                stream = result;
                draw();
            });
        }

        function load(id) {
            var previous = prefs.lastId === id ? prefs.position : null;
            prefs.position = previous;
            prefs.enteredId = id;
            loadedId = id;
            draft = id;
            data = episode = variant = stream = null;
            persist();
            setMessage('');
            var job = begin('catalog');
            draw();

            listen(job, function (done) { return catalog.load(id, done); }, function (error, result) {
                request = null;
                if (error || !result.episodes.length) {
                    setMessage(error ? error.message : 'По этому content-id источник не вернул видео.', true);
                    draw();
                    return;
                }
                data = result;
                setEpisode(catalogModel.findEpisode(data, previous) || data.episodes[0]);
                persist();
                var key = view.key();
                var next = (key === 'load' || key === 'id') && inPanel() ? (variant ? 'play' : 'episode') : key;
                readQuality(next);
            });
        }

        function selectEpisode(entry, focus) {
            setMessage('');
            setEpisode(entry);
            persist();
            readQuality(focus);
        }

        function restore(key) {
            if (!current()) return;
            focusOnToggle = key;
            controller.add('content', controls);
            controller.toggle('content');
        }

        function interruptPlay() {
            if (request && request.kind === 'play') {
                stopRequest();
                draw();
            }
        }

        function showSelect(key, name, options, selected) {
            interruptPlay();
            Lampa.Select.show({
                title: name,
                items: options,
                onSelect: function (choice) {
                    if (!current()) return;
                    selected(choice.value);
                    restore(key);
                },
                onBack: function () { restore(key); }
            });
        }

        function editId() {
            interruptPlay();
            Lampa.Input.edit({
                title: 'Введите content-id',
                value: draft,
                free: true,
                nosave: true,
                nomic: true,
                layout: 'nums'
            }, function (value) {
                if (!current()) return;
                // Lampa also confirms the field when Back closes its keyboard.
                if (typeof value === 'string' && value.trim()) {
                    draft = value.trim().slice(0, 64);
                    var id = catalogModel.contentId(draft);
                    if (id) {
                        prefs.enteredId = id;
                        writeState(browser, prefs);
                    }
                    setMessage('');
                    draw();
                }
                restore('id');
            });
        }

        function launch(url) {
            var label = title();
            if (!data.single) label += ' · ' + catalogModel.seasonLabel(episode.season) + ' · ' + episodeTitle(episode);
            try {
                if (typeof Lampa.Player.callback === 'function') {
                    Lampa.Player.callback(function () { restore('play'); });
                }
                Lampa.Player.play({ url: url, title: label });
            } catch (error) {
                if (typeof Lampa.Player.callback === 'function') Lampa.Player.callback(null);
                setMessage('Lampa не смогла запустить плеер.', true);
                draw('play');
            }
        }

        function play() {
            if (!variant || (request && request.kind === 'play')) return;
            setMessage('');
            var job = begin('play');
            var previousVariant = variant;
            var previousEpisode = episode;
            var wanted = qualityPreference();
            var explicit = stream && resolvePlayback(stream, wanted).quality !== 'auto';
            draw('play');

            listen(job, function (done) { return catalog.load(loadedId, done); }, function (error, result) {
                var updated = !error && catalogModel.findEpisode(result, previousEpisode);
                if (!updated) {
                    request = null;
                    setMessage(error ? error.message : 'Видео исчезло из списка. Загрузите content-id заново.', true);
                    draw();
                    return;
                }

                data = result;
                setEpisode(updated);
                persist();
                if (!variant || variant.voice !== previousVariant.voice || variant.name !== previousVariant.name) {
                    setMessage(variant ? 'Озвучки обновились. Проверьте выбор и нажмите «Воспроизвести» ещё раз.' :
                        'Для этого видео больше нет ссылки у источника.', true);
                    readQuality('voice');
                    return;
                }

                inspectVariant(job, variant, function (result) {
                    request = null;
                    stream = result;
                    var chosen = resolvePlayback(stream, wanted);
                    if (explicit && chosen.quality !== wanted) {
                        setMessage('Источник больше не подтверждает ' + wanted +
                            'p. Проверьте качество или нажмите «Воспроизвести» ещё раз.', true);
                        draw('quality');
                        return;
                    }
                    draw();
                    if (inPanel()) launch(chosen.url);
                });
            });
        }

        var actions = {
            id: editId,
            load: function () {
                var id = catalogModel.contentId(draft);
                if (!id) {
                    setMessage('Введите положительный content-id цифрами.', true);
                    draw('id');
                    return;
                }
                load(id);
            },
            season: function () {
                showSelect('season', 'Сезоны', data.seasons.map(function (season) {
                    return item(season, catalogModel.seasonLabel(season.order), episode.season === season.order);
                }), function (season) {
                    if (season.order !== episode.season) selectEpisode(season.episodes[0]);
                });
            },
            episode: function () {
                var season = data.seasons.filter(function (entry) { return entry.order === episode.season; })[0];
                showSelect('episode', 'Серии', season.episodes.map(function (entry) {
                    return item(entry, episodeTitle(entry), entry === episode);
                }), function (entry) { if (entry !== episode) selectEpisode(entry); });
            },
            voice: function () {
                showSelect('voice', 'Озвучка', episode.variants.map(function (entry) {
                    return item(entry, entry.name, entry === variant);
                }), function (entry) {
                    var changed = variant !== entry;
                    variant = entry;
                    prefs.voice = { episode: episode.key, key: entry.key, voice: entry.voice, name: entry.name };
                    persist();
                    setMessage('');
                    if (changed || !stream) readQuality();
                    else draw();
                });
            },
            quality: function () {
                var selected = resolvePlayback(stream, qualityPreference()).quality;
                var options = [item('auto', 'Авто · максимум (' + stream.variants[0].height + 'p)', selected === 'auto')];
                stream.variants.forEach(function (level) {
                    var height = String(level.height);
                    options.push(item(height, height + 'p', selected === height));
                });
                showSelect('quality', 'Качество', options, function (value) {
                    prefs.quality = value;
                    persist();
                    setMessage('');
                    draw();
                });
            },
            play: play,
            prev: function () { selectEpisode(data.episodes[data.episodes.indexOf(episode) - 1], 'prev'); },
            next: function () { selectEpisode(data.episodes[data.episodes.indexOf(episode) + 1], 'next'); }
        };

        var controls = {
            toggle: function () {
                view.restore(focusOnToggle);
                focusOnToggle = null;
            },
            gone: interruptPlay,
            enter: view.enter,
            left: function () { if (!view.move('left')) controller.toggle('menu'); },
            right: function () { view.move('right'); },
            up: function () { if (!view.move('up')) controller.toggle('head'); },
            down: function () { view.move('down'); },
            back: function () {
                stopRequest();
                Lampa.Activity.backward();
            }
        };

        this.create = function () { draw(); };
        this.render = function (js) { return js ? view.root[0] : view.root; };
        this.start = function () {
            restore();
            if (!started) {
                started = true;
                if (draft) load(draft);
            } else if (loadedId && !data && !request && !message) {
                load(loadedId);
            } else if (episode && variant && !stream && !request) {
                readQuality();
            }
        };
        this.pause = this.stop = stopRequest;
        this.destroy = function () {
            destroyed = true;
            stopRequest();
            view.root.remove();
        };
    };
}

module.exports = makeComponent;
},
"./main": function (module, require) {
'use strict';

var transport = require('./transport');
var createCatalog = require('./catalog').createCatalog;
var createStreamInspector = require('./hls').createStreamInspector;
var makeComponent = require('./screen');
var style = require('./style');

var COMPONENT = 'lampa_content_id';
var TITLE = 'Видео по ID';
var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m10 8.5 5 3.5-5 3.5z"/></svg>';

function boot(browser) {
    if (browser.__lampaContentIdBoot) return;
    browser.__lampaContentIdBoot = true;

    function init() {
        var Lampa = browser.Lampa;
        var $ = browser.jQuery || browser.$;
        if (browser.document.querySelector('.lci-menu')) return;
        if (!Lampa.Component || !Lampa.Activity || !Lampa.Controller || !Lampa.Input ||
            !Lampa.Select || !Lampa.Player || typeof Lampa.Player.play !== 'function') {
            if (Lampa.Noty) Lampa.Noty.show('Видео по ID: эта сборка Lampa не предоставляет нужные функции.');
            return;
        }

        function open() {
            var active = Lampa.Activity.active();
            if (active && active.component === COMPONENT) {
                Lampa.Controller.toggle('content');
                return;
            }
            Lampa.Activity.push({ component: COMPONENT, title: TITLE, url: '', page: 1 });
        }

        var menu;
        if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
            menu = Lampa.Menu.addButton(ICON, TITLE, open);
        } else {
            // Older builds expose the menu DOM without Menu.addButton.
            var list = $('.menu .menu__list').first();
            if (!list.length) return;
            menu = $('<li class="menu__item selector"></li>')
                .append($('<div class="menu__ico"></div>').append(ICON))
                .append($('<div class="menu__text"></div>').text(TITLE))
                .on('hover:enter', open).appendTo(list);
        }
        menu.addClass('lci-menu').attr('data-action', COMPONENT);
        if (!browser.MutationObserver) menu.on('click', open);

        $('<style type="text/css"></style>').text(style).appendTo(browser.document.head);
        var get = transport.createTransport(browser);
        var resolve = transport.createUrlResolver(browser);
        var catalog = createCatalog(get, resolve);
        var inspect = createStreamInspector(browser, get, resolve);
        Lampa.Component.add(COMPONENT, makeComponent(browser, $, Lampa, catalog, inspect, function (id) {
            return id === '144537' ? 'Против всех' : '';
        }));
    }

    function whenLampaAvailable(attempts) {
        var Lampa = browser.Lampa;
        if (Lampa && (browser.jQuery || browser.$)) {
            if (browser.appready) init();
            else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
        } else if (attempts < 100) {
            browser.setTimeout(function () { whenLampaAvailable(attempts + 1); }, 250);
        }
    }

    whenLampaAvailable(0);
}

module.exports = boot;
},
"./style": function (module) { module.exports = ".lci {\n    box-sizing: border-box;\n    height: calc(100vh - 5em);\n    overflow-x: hidden;\n    overflow-y: auto;\n    padding: 1.35em 1.65em 2.25em;\n    color: #f5f7fc;\n    -webkit-overflow-scrolling: touch;\n}\n.lci-panel {\n    box-sizing: border-box;\n    width: 100%;\n    max-width: 43em;\n    margin: 0 auto;\n    padding: 1.55em;\n    border: 1px solid #364154;\n    border-radius: .85em;\n    background: #1d2636;\n}\n.lci-eyebrow {\n    margin-bottom: .7em;\n    color: #a7b7cf;\n    font-size: .73em;\n    font-weight: bold;\n    letter-spacing: .12em;\n}\n.lci-eyebrow.lci-has-id { color: #81e1cb; }\n.lci-title {\n    margin: 0;\n    font-size: 1.8em;\n    line-height: 1.16;\n    word-wrap: break-word;\n}\n.lci-subtitle {\n    margin: .55em 0 1.1em;\n    color: #b9c6da;\n    line-height: 1.35;\n}\n.lci-row {\n    display: -webkit-box;\n    display: -webkit-flex;\n    display: flex;\n    margin: 0 -.35em .7em;\n}\n.lci-tile {\n    position: relative;\n    display: -webkit-box;\n    display: -webkit-flex;\n    display: flex;\n    -webkit-box-flex: 1;\n    -webkit-box-orient: vertical;\n    -webkit-box-pack: center;\n    -webkit-flex: 1 1 0;\n    flex: 1 1 0;\n    -webkit-flex-direction: column;\n    flex-direction: column;\n    -webkit-justify-content: center;\n    justify-content: center;\n    box-sizing: border-box;\n    min-width: 0;\n    min-height: 3.1em;\n    margin: 0 .35em;\n    padding: .65em .85em;\n    border: 2px solid transparent;\n    border-radius: .52em;\n    background: #2e3a50;\n    color: #f4f7fc;\n    line-height: 1.25;\n    overflow: hidden;\n    -webkit-tap-highlight-color: transparent;\n}\n.lci-tile.selector { cursor: pointer; }\n.lci-caption {\n    margin-bottom: .2em;\n    color: #bdcbe0;\n    font-size: .75em;\n}\n.lci-value {\n    font-size: 1em;\n    font-weight: bold;\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n}\n.lci-tile[data-lci-key=\"prev\"] .lci-value,\n.lci-tile[data-lci-key=\"next\"] .lci-value {\n    white-space: normal;\n}\n.lci-choice {\n    position: absolute;\n    right: .56em;\n    top: 50%;\n    margin-top: -.66em;\n    font-size: 1.4em;\n    color: #bbd4f3;\n}\n.lci-tile[data-lci-key=\"id\"],\n.lci-tile[data-lci-key=\"season\"],\n.lci-tile[data-lci-key=\"episode\"],\n.lci-tile[data-lci-key=\"voice\"],\n.lci-tile[data-lci-key=\"quality\"] { padding-right: 1.75em; }\n.lci-tile.lci-play {\n    min-height: 3.15em;\n    background: #93f1da;\n    color: #112d2e;\n    text-align: center;\n}\n.lci-tile.lci-disabled {\n    opacity: .57;\n    cursor: default;\n}\n.lci-tile.selector.lci-active,\n.lci-tile.selector.focus {\n    border-color: #ffffff;\n    background: #465d80;\n    color: #ffffff;\n    box-shadow: 0 0 0 2px #101827;\n}\n.lci-tile.lci-play.selector.lci-active,\n.lci-tile.lci-play.selector.focus {\n    background: #c2fff0;\n    color: #112d2e;\n}\n.lci-status {\n    min-height: 1.3em;\n    margin: .9em 0 0;\n    color: #c6d7ed;\n    font-size: .88em;\n    line-height: 1.45;\n}\n.lci-status.lci-status-error { color: #ffd1a8; }\n@media (max-width: 600px) {\n    .lci { padding: .65em .7em 1.25em; }\n    .lci-panel { padding: .85em; }\n    .lci-tile { padding-left: .58em; min-height: 3.25em; }\n}\n"; }
};
var cache = {};
function require(name) {
    if (!cache[name]) {
        var module = cache[name] = { exports: {} };
        modules[name](module, require);
    }
    return cache[name].exports;
}
require('./main')(window);
}(window));
