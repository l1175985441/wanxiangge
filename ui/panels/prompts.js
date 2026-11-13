/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { describePreset, listPresets } from '../../core/preset.js'; import { effectivePrompt, getSettings } from '../../core/settings.js'; import { expandPair } from '../controls-note.js'; import { promptVarRows, purposeOf } from '../prompt-copy.js'; import { saveBar, stage } from '../sections.js'; import { button, card, checkbox, el, foldable, row, section, select, textInput, textarea } from './shared.js';

export function secPrompts(host) {
    const s = getSettings();
    const box = section('提示词（可看可改）',
        '留空＝用内置默认；填了＝原样用你写的。破限词同理。'
        + '下面每块先显示**当前实际用的那份**（留空就是内置的），想改再点「改这套」。',
        { open: false, five: true });
    /*
     * ⭐ 一屏一个焦点（复核方第一条）：**只把第一块摊开**，其余三块收起。
     *    四块内容差不多、都很长 ⇒ 全摊开就是"一屏四张卡"，正是他说要避免的。
     *    收起不等于藏起来：卡头那行字还在，点一下就展开（⛔ 不丢任何东西）。
     */
    const cHead = card('注入块开头那句');
    cHead.appendChild(el('div', 'wxg-note', '每轮注入的最前面那一行，声明"这是引擎附注"。'));
    cHead.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt('header')));
    const editHead = foldable('改这套（留空＝用内置）', false);
    editHead.appendChild(textarea('wxg-inject-header', s.injectHeader, '（留空＝用内置那份）', 'stage-inject-header', 3));
    cHead.appendChild(editHead);
        box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
box.appendChild(cHead);
    const cMore = card('后台推演与破限提示词（按需展开）');
    const addFoldedPrompt = (title, keyVal, kind, id, rows, hint) => {
        /* 17-1：用途副标（文案在 ui/prompt-copy.js，主文件别再长） */
    /* 81：折叠行只留名词；用途与字数进 title */
    const fold = foldable(title, false);
    fold.title = (purposeOf(kind).replace(/^ · /, '') + ' · 展开看这套（' + String(effectivePrompt(kind).length) + ' 字）').trim();
        const body = el('div', 'wxg-report-body');
        body.appendChild(el('div', 'wxg-note', hint));
    if (['worldLayer', 'situation', 'hiddenLayer', 'chronicle'].includes(kind) && s.layerPrompts !== true) {
        body.appendChild(el('div', 'wxg-note', '⚠️ 这一层现在是关的，改了不生效（要开在上面的总开关）'));
    }
        body.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt(kind)));
        const edit = foldable('改这套（留空＝用内置）', false);
        edit.appendChild(textarea(id, keyVal, '（留空＝用内置那份）', 'stage-' + id.replace('wxg-', ''), rows));
        body.appendChild(edit);
        fold.appendChild(body);
        cMore.appendChild(fold);
    };
    /*
     * 17-2：她改提示词时要知道能引用什么（全库此前 0 个变量清单）。
     *   清单在 ui/prompt-copy.js；这里只负责装进卡里。
     */
    const cVars = foldable('能写哪些变量', false);
    for (const row of promptVarRows()) {
        cVars.appendChild(el('div', 'wxg-note', row[0] + '  ' + row[1]));
    }
    cMore.appendChild(cVars);
    {
        const layRow = el('div', 'wxg-row');
        const layCb = document.createElement('input');
        layCb.type = 'checkbox';
        layCb.id = 'wxg-layer-prompts';
        layCb.setAttribute('data-action', 'toggle-layer-prompts');
        layCb.checked = s.layerPrompts === true;
        layRow.appendChild(layCb);
        layRow.appendChild(el('span', 'wxg-note', '四层提示词（世界／局势／暗流／编年）—— 当前：' + (s.layerPrompts === true ? '开' : '关')));
        cMore.appendChild(layRow);
    }
    addFoldedPrompt('世界推演提示词', s.promptWorld, 'world', 'wxg-prompt-world', 8,
        '让模型推"世界现在什么样"时用的那套规矩。');
    addFoldedPrompt('角色状态／平行事件提示词', s.promptChars, 'chars', 'wxg-prompt-chars', 8,
        '让模型写每个角色的平行线时用的那套规矩。');
    addFoldedPrompt('前台人物层提示词', s.promptFront, 'front', 'wxg-prompt-front', 8,
        '只管正文里在场的人；不许推演、不许编。留空＝用内置。');
    addFoldedPrompt('后台人物层提示词', s.promptBack, 'back', 'wxg-prompt-back', 8,
        '没出场的人：允许推演，但不当实锤。留空＝用内置。');
    addFoldedPrompt('世界层提示词', s.promptWorldLayer, 'worldLayer', 'wxg-prompt-worldlayer', 8,
        '背景板：天气、经济、政策、组织压力。留空＝用内置。');
    addFoldedPrompt('局势层提示词', s.promptSituation, 'situation', 'wxg-prompt-situation', 8,
        '台面上谁跟谁顶着（至少两方）。留空＝用内置。');
    addFoldedPrompt('暗流层提示词', s.promptHiddenLayer, 'hiddenLayer', 'wxg-prompt-hidden', 8,
        '背后攒劲：谁在办、办到第几步。留空＝用内置。');
    addFoldedPrompt('编年层提示词', s.promptChronicle, 'chronicle', 'wxg-prompt-chronicle', 8,
        '往回看：之前发生过什么。留空＝用内置。');
    addFoldedPrompt('破限词', s.jailbreak, 'jailbreak', 'wxg-jailbreak', 6,
        '模型有时候"不填东西"——这一段是逼它老实填字段用的。');
    const resetRow = el('div', 'wxg-card-actions');
    row(resetRow, button('全部恢复内置默认', 'reset-prompts'),
        el('span', 'wxg-note', '（只清提示词，不动你的开关）'));
    cMore.appendChild(resetRow);
    box.appendChild(cMore);
    /*
     * 依据＝阿砚第四批 4-a E3（三家都有的提示词预设库）：
     *   ① 多套命名（名字＋时间＋字数） ② 内置不可删，只能另存为副本
     *   ③ 颗粒度可以到**单个块** ④ 导入导出带 kind/version ⑤ 应用时⛔ 重建现场
     */
    const cPreset = card('提示词预设（可只存一块）');
    cPreset.appendChild(el('div', 'wxg-note', '内置那几套不能删（要改就另存为副本）；"应用"只改提示词，不会重算。'));
    const presets = listPresets(s);
    const presetOpts = presets.map((pp) => ({ value: pp.id, label: pp.name + '（' + describePreset(pp) + '）' }));
    if (!presetOpts.length) {
        presetOpts.push({ value: '', label: '（还没有预设）' });
    }
    const presetRow = el('div', 'wxg-card-actions');
    presetRow.appendChild(select('wxg-preset-sel', presetOpts, presets.length ? presets[0].id : '', 'noop'));
    presetRow.appendChild(button('应用', 'apply-preset', 'wxg-btn-sm'));
    presetRow.appendChild(button('删除', 'delete-preset', 'wxg-btn-xs'));
    cPreset.appendChild(presetRow);
    const blockRow = el('div', 'wxg-card-actions');
    blockRow.appendChild(el('span', 'wxg-note', '另存为副本时存哪一块：'));
    blockRow.appendChild(select('wxg-preset-block', [
        { value: 'all', label: '整套（四块）' },
        { value: 'world', label: '只存「世界推演」' },
        { value: 'chars', label: '只存「角色状态／平行事件」' },
        { value: 'jailbreak', label: '只存「破限词」' },
        { value: 'header', label: '只存「开头那句」' },
    ], 'all', 'noop'));
    blockRow.appendChild(textInput('wxg-preset-name', '', '新预设的名字', 'noop'));
    blockRow.appendChild(button('另存为副本', 'save-preset', 'wxg-btn-sm'));
    cPreset.appendChild(blockRow);
    const ioRow = el('div', 'wxg-card-actions');
    ioRow.appendChild(button('导出整包', 'export-presets', 'wxg-btn-xs'));
    ioRow.appendChild(button('导入整包', 'import-presets', 'wxg-btn-xs'));
    cPreset.appendChild(ioRow);
    const ioBox = textarea('wxg-preset-io', '', '导出的 JSON 就在这里（复制走）；导入就把 JSON 粘进来再点导入', 'noop', 4);
    cPreset.appendChild(ioBox);
    box.appendChild(cPreset);
    box.appendChild(saveBar('prompts'));
    host.appendChild(box);


}
