/**
 * 万象阁 · 每层额度／模型（127 笔 3）
 *
 * 五层各一行：额度（maxTokens，留空＝全局）＋ 模型（model，留空＝全局）。
 * ⛔ 默认全空 ⇒ 行为与改前完全一致；⛔ 不加 timeout／retries（另一层，这次不做）。
 */

import { getSettings, patchSettings } from '../core/settings.js';
import { trimText } from '../core/utils.js';

const LAYERS = [
    ['world', '世界层'],
    ['situation', '局势层'],
    ['hidden', '暗流层'],
    ['front', '前台'],
    ['back', '后台'],
];

function mkInput(type, layer, field, value, placeholder) {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'wxg-input wxg-layer-limit';
    inp.setAttribute('data-layer', layer);
    inp.setAttribute('data-field', field);
    inp.placeholder = placeholder;
    if (value !== null && value !== undefined && String(value) !== '') {
        inp.value = String(value);
    }
    return inp;
}

/** 把这块挂进一个容器（工作台「总控」页） */
export function mountLayerLimits(host) {
    const s = getSettings();
    const table = s.layerLimits || {};
    const box = document.createElement('div');
    box.className = 'wxg-card';
    const head = document.createElement('div');
    head.className = 'wxg-card-h';
    head.textContent = '每层额度／模型（留空即用全局）';
    box.appendChild(head);
    const note = document.createElement('div');
    note.className = 'wxg-note';
    note.textContent = '五层各自可填：额度（数字，留空＝全局）｜模型（留空＝全局）。默认全空，行为与以前完全一致。';
    box.appendChild(note);
    for (const [key, label] of LAYERS) {
        const row = document.createElement('div');
        row.className = 'wxg-row';
        const lab = document.createElement('span');
        lab.className = 'wxg-note';
        lab.textContent = label;
        row.appendChild(lab);
        const cur = table[key] || {};
        row.appendChild(mkInput('number', key, 'maxTokens', cur.maxTokens, '额度（全局）'));
        row.appendChild(mkInput('text', key, 'model', cur.model || '', '模型（全局）'));
        box.appendChild(row);
    }
    const actions = document.createElement('div');
    actions.className = 'wxg-card-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wxg-btn wxg-primary';
    btn.setAttribute('data-action', 'save-layer-limits');
    btn.textContent = '保存每层参数';
    actions.appendChild(btn);
    box.appendChild(actions);
    host.appendChild(box);
    return box;
}

/** 从当前工作台读回五层并落盘（空 ⇒ null／''，回落全局） */
export function saveLayerLimits(root) {
    const scope = root || document;
    const next = {};
    for (const [key] of LAYERS) {
        const tokEl = scope.querySelector('[data-layer="' + key + '"][data-field="maxTokens"]');
        const modEl = scope.querySelector('[data-layer="' + key + '"][data-field="model"]');
        const tokRaw = tokEl ? trimText(tokEl.value) : '';
        const tok = Number(tokRaw);
        next[key] = {
            maxTokens: (tokRaw && Number.isFinite(tok) && tok > 0) ? tok : null,
            model: modEl ? trimText(modEl.value) : '',
        };
    }
    patchSettings({ layerLimits: next });
    return next;
}
