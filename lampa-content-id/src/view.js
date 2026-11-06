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
