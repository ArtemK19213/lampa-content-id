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
