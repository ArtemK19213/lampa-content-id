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
