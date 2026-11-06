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
