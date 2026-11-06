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
