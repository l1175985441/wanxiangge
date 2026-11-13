/* 公-3 片段：跳到某段／滚动高亮。从 shared.js 抽出（206 后） */
import { el } from './shared.js';
import { asArray, trimText } from '../../core/utils.js';


export function buildJumpNav(host) {
    if (!host) {
        return;
    }
    const old = host.querySelector('.wxg-nav');
    if (old) {
        old.remove();
    }
    if (host.getAttribute('data-wxg-mode') !== 'panel') {
        return;   // 窄栏不画
    }
    const nav = el('div', 'wxg-nav');
    nav.appendChild(el('span', 'wxg-nav-title', '跳到'));
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    secs.forEach((sec, i) => {
        const titleEl = sec.querySelector('.wxg-sec-title');
        const name = trimText(titleEl && titleEl.textContent) || ('第 ' + String(i + 1) + ' 段');
        const btn = el('button', 'wxg-nav-btn', name);
        btn.type = 'button';
        btn.setAttribute('data-jump', String(i));
        nav.appendChild(btn);
    });
    const first = (host.children && host.children.length) ? host.children[0] : null;
    if (first) {
        host.insertBefore(nav, first);
    } else {
        host.appendChild(nav);
    }
    bindNavScrollSpy(host, nav);
    markActiveNav(host, nav);
}
/**
 * 滚动时把"当前所在那一段"高亮出来。
 * ⚠️ 监听挂在**宿主**（面板正文层）上，每次重画前先解绑，⛔ 免得叠一堆监听器。
 */
function bindNavScrollSpy(host, nav) {
    if (typeof host.removeEventListener === 'function' && host.__wxgSpy) {
        host.removeEventListener('scroll', host.__wxgSpy);
        host.__wxgSpy = null;
        if (host.__wxgEndTimer) {
            clearTimeout(host.__wxgEndTimer);
            host.__wxgEndTimer = null;
        }
    }
    if (typeof host.addEventListener !== 'function' || typeof requestAnimationFrame !== 'function') {
        return;
    }
    const spy = () => {
        if (host.__wxgSpyBusy) {
            return;
        }
        host.__wxgSpyBusy = true;
        requestAnimationFrame(() => {
            host.__wxgSpyBusy = false;
            markActiveNav(host, nav);
        });
    };
    host.__wxgSpy = spy;
    host.addEventListener('scroll', spy);
}
/** 哪一段离顶端最近，就把哪一颗点亮 */
function markActiveNav(host, nav) {
    if (!host || !nav) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const btns = asArray(nav.querySelectorAll('.wxg-nav-btn'));
    if (!secs.length || !btns.length) {
        return;
    }
    const hostTop = Number(host.getBoundingClientRect ? host.getBoundingClientRect().top : 0);
    const line = hostTop + 24;
    let active = 0;
    secs.forEach((sec, i) => {
        const top = sec.getBoundingClientRect ? sec.getBoundingClientRect().top : 0;
        if (top <= line) {
            active = i;
        }
    });
    btns.forEach((b, i) => {
        const on = i === active;
        if (b.classList) {
            b.classList.toggle('is-on', on);
        } else {
            b.setAttribute('class', on ? 'wxg-nav-btn is-on' : 'wxg-nav-btn');
        }
    });
}
/** 跳转条上的点击：滚到那一段，并顺手把它展开（不然滚到了还是收着的） */
export function jumpToSection(host, index) {
    if (!host) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const sec = secs[Number(index)];
    if (!sec) {
        return;
    }
    const body = sec.querySelector('.wxg-sec-body');
    if (body && body.style) {
        body.style.display = 'block';
    }
    const icon = sec.querySelector('.inline-drawer-icon');
    if (icon && icon.classList) {
        icon.classList.remove('down');
        icon.classList.add('up');
    }
    if (typeof sec.scrollIntoView === 'function') {
        try {
            sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (e) {
            sec.scrollIntoView();
        }
    }
}

