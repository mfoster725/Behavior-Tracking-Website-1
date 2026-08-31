/**
 * Block browser/password-manager autofill everywhere except real login
 * username/password fields (autocomplete="username" | "current-password").
 * Loaded in <head> so inputs are hardened as they are parsed, before Chrome fills.
 */
(function () {
    'use strict';

    var SKIP_TYPES = {
        hidden: 1, checkbox: 1, radio: 1, file: 1, button: 1, submit: 1,
        reset: 1, range: 1, color: 1, image: 1
    };
    var READONLY_TYPES = {
        text: 1, search: 1, email: 1, tel: 1, url: 1, password: 1, '': 1
    };

    function loginCredentialAutocomplete(value) {
        var ac = String(value || '').toLowerCase();
        return ac === 'username' || ac === 'current-password';
    }

    function isLoginCredentialField(el) {
        if (!el || !el.getAttribute) return false;
        if (el.dataset && el.dataset.allowAutocomplete === 'true') return true;
        return loginCredentialAutocomplete(el.getAttribute('autocomplete'));
    }

    function isSkippable(el) {
        if (!el || el.nodeName !== 'INPUT') return true;
        if (isLoginCredentialField(el)) return true;
        var type = String(el.type || '').toLowerCase();
        return !!SKIP_TYPES[type];
    }

    function isSearchField(el) {
        if (!el || el.nodeName !== 'INPUT') return false;
        var type = String(el.type || '').toLowerCase();
        if (type === 'search') return true;
        var blob = [
            el.id || '',
            el.name || '',
            el.className || ''
        ].join(' ').toLowerCase();
        return blob.indexOf('search') !== -1;
    }

    function markTyped(el) {
        el.dataset.autofillUserTyped = '1';
    }

    function unlock(el) {
        if (el.hasAttribute('readonly') && el.dataset.autofillReadonlyLock === '1') {
            el.removeAttribute('readonly');
        }
    }

    function credentialValues() {
        var u = window.currentUser;
        if (!u) return [];
        var out = [];
        if (u.username) out.push(String(u.username).trim().toLowerCase());
        if (u.name) out.push(String(u.name).trim().toLowerCase());
        return out.filter(Boolean);
    }

    function looksInjected(el) {
        if (!isSearchField(el)) return false;
        if (el.dataset.autofillUserTyped === '1') return false;
        if (el.dataset.allowPrefill === 'true' || el.dataset.allowPrefill === '1') return false;
        var value = String(el.value || '').trim();
        if (!value) return false;
        if (el.defaultValue && String(el.defaultValue).trim() === value) return false;

        var suspects = credentialValues();
        if (suspects.indexOf(value.toLowerCase()) !== -1) return true;

        // Empty-by-design search bars: clear a pre-focus dump, but keep values
        // chosen from our own dropdowns after the user focused the field.
        return !String(el.defaultValue || '').trim() && el.dataset.autofillTouched !== '1';
    }

    function clearInjected(el) {
        if (!looksInjected(el)) return;
        el.value = '';
        try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) { /* ignore */ }
    }

    function harden(el) {
        if (isSkippable(el)) return;
        if (el.dataset.autofillHardened === '1') {
            clearInjected(el);
            return;
        }
        el.dataset.autofillHardened = '1';

        var type = String(el.type || '').toLowerCase();
        el.setAttribute('autocomplete', type === 'password' ? 'new-password' : 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
        el.setAttribute('data-lpignore', 'true');
        el.setAttribute('data-1p-ignore', 'true');
        el.setAttribute('data-bwignore', 'true');
        el.setAttribute('data-form-type', 'other');

        if (READONLY_TYPES[type] && !el.hasAttribute('readonly')) {
            el.setAttribute('readonly', 'readonly');
            el.dataset.autofillReadonlyLock = '1';
        }

        el.addEventListener('pointerdown', function () { unlock(el); });
        el.addEventListener('focus', function () {
            unlock(el);
            requestAnimationFrame(function () {
                clearInjected(el);
                el.dataset.autofillTouched = '1';
            });
        });
        el.addEventListener('keydown', function () { markTyped(el); });
        el.addEventListener('paste', function () { markTyped(el); });
        el.addEventListener('drop', function () { markTyped(el); });

        clearInjected(el);
    }

    function hardenTree(root) {
        if (!root) return;
        if (root.nodeType === 1 && root.matches && root.matches('input')) harden(root);
        if (root.querySelectorAll) {
            var nodes = root.querySelectorAll('input');
            for (var i = 0; i < nodes.length; i++) harden(nodes[i]);
        }
    }

    function scan() {
        hardenTree(document);
    }

    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                hardenTree(added[j]);
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    scan();
    document.addEventListener('DOMContentLoaded', function () {
        scan();
        [50, 200, 600, 1500, 3000].forEach(function (ms) {
            setTimeout(scan, ms);
        });
    });
    window.addEventListener('pageshow', scan);

    document.addEventListener('input', function (e) {
        var el = e.target;
        if (!el || el.nodeName !== 'INPUT') return;
        if (isLoginCredentialField(el)) return;
        if (el.dataset.autofillUserTyped === '1') return;
        clearInjected(el);
    }, true);

    document.addEventListener('animationstart', function (e) {
        if (e.animationName !== 'bts-on-autofill') return;
        var el = e.target;
        if (!el || el.nodeName !== 'INPUT') return;
        if (isLoginCredentialField(el)) return;
        if (el.dataset.autofillUserTyped === '1') return;
        if (looksInjected(el)) {
            el.value = '';
            try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { /* ignore */ }
        }
    }, true);

    window.BTSKillAutofill = { harden: harden, scan: scan };
})();
