(() => {
    'use strict';

    const BASE = '/AgentEnvolveBook/';
    const ZH_PREFIX = BASE + 'zh/';

    function isZh() {
        return window.location.pathname.startsWith(ZH_PREFIX);
    }

    function mirrorPath(toZh) {
        const path = window.location.pathname;
        if (toZh) {
            if (path.startsWith(ZH_PREFIX)) return path;
            const rel = path.startsWith(BASE) ? path.slice(BASE.length) : '';
            return ZH_PREFIX + rel;
        } else {
            if (!path.startsWith(ZH_PREFIX)) return path;
            return BASE + path.slice(ZH_PREFIX.length);
        }
    }

    function render() {
        const zh = isZh();
        const sw = document.createElement('div');
        sw.className = 'lang-switch';

        const enLink = document.createElement('a');
        enLink.textContent = 'EN';
        enLink.href = mirrorPath(false);
        if (!zh) enLink.className = 'active';

        const zhLink = document.createElement('a');
        zhLink.textContent = '中文';
        zhLink.href = mirrorPath(true);
        if (zh) zhLink.className = 'active';

        sw.appendChild(enLink);
        sw.appendChild(zhLink);
        document.body.appendChild(sw);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
