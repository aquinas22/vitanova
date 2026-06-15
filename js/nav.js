/* ==========================================================================
   nav.js — mobile hamburger menu toggle, shared across all pages.
   No dependencies; safe to include on any page with a .site-header.
   ========================================================================== */
(function () {
    'use strict';
    var toggle = document.getElementById('nav-toggle');
    if (!toggle) return;
    var header = toggle.closest('.site-header');
    var nav = header && header.querySelector('.site-nav');
    if (!header || !nav) return;

    function setOpen(open) {
        header.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!header.classList.contains('nav-open'));
    });
    // Close after tapping any link or button inside the menu.
    nav.addEventListener('click', function (e) {
        if (e.target.closest('a, button')) setOpen(false);
    });
    // Close when tapping outside, or on Escape.
    document.addEventListener('click', function (e) {
        if (header.classList.contains('nav-open') && !header.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setOpen(false);
    });
})();
