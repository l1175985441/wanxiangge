/**
 * 万象阁 · 外观（我们自己的配色系统）
 *
 * ⭐ 为什么不跟随酒馆主题（她拍的）：工作台是**我们自己的整页窗口**——自己的地盘，
 *    配色就该自己定；不然在浅色主题下我们深色窗口里那些灰、那些强调色全都要迁就，
 *    怎么做都别扭。设置抽屉那边仍然自动跟随酒馆主题（那是**别人的地盘**）。
 *
 * 组成：**预设色板**（砚墨／松烟／靛青／朱砂／素笺）＋ 四个槽位可单独改（强调／底面／文字／描边）。
 * 文字色默认**按底面亮度自动算**（浅底给深字、深底给浅字）⇒ 她选了任何颜色都不会看不清。
 */

export const PALETTE_KEYS = ['ink', 'amber', 'pine', 'azure', 'cinnabar', 'paper', 'custom'];

export const PALETTE_NAMES = {
    ink: '砚墨（深灰＋青绿）',
    amber: '暖灯（奶咖＋琥珀）',
    pine: '松烟（墨绿＋米白）',
    azure: '靛青（藏蓝＋天青）',
    cinnabar: '朱砂（暖褐＋朱红）',
    paper: '素笺（浅色纸感）',
    custom: '自定义',
};

/** 预设色板（只给四个槽位） */
export const PALETTES = {
    ink: { accent: '#5fbf9b', surface: '#1d1f23', bg: '#141619', border: '#3a3f46' },
    /*
     * ⭐ 暖灯（对照 SP 数据库新版那套：奶米黄底＋琥珀重点）。
     * 为什么加：复核方说"暖色可上"——工具型页面不一定非得冷灰；
     * 深色底用暖褐，重点色用琥珀，比青绿更像"灯下看账本"。
     */
    amber: { accent: '#e0a83c', surface: '#26201a', bg: '#1a1512', border: '#4a3d2e' },
    pine: { accent: '#8fbf6a', surface: '#1b2019', bg: '#12160f', border: '#3b4634' },
    azure: { accent: '#6aa9e0', surface: '#1a1f28', bg: '#11151b', border: '#334255' },
    cinnabar: { accent: '#e0654f', surface: '#241d1a', bg: '#181210', border: '#4a352e' },
    paper: { accent: '#2f8f6a', surface: '#fbfaf7', bg: '#ecebe6', border: '#cfcdc4' },
    custom: null,
};

export const DEFAULT_APPEARANCE = Object.freeze({
    palette: 'ink',
    accent: '#5fbf9b',
    surface: '#1d1f23',
    bg: '#141619',
    border: '#3a3f46',
    text: '',            // 留空＝按底面亮度自动算
    applyToPanel: true,  // 这套配色是否也用在浮层面板／悬浮小框上
});

/* ------------------------------ 颜色小工具 ------------------------------ */

/** #RRGGBB → {r,g,b}（认 3 位缩写；认不出来返回 null） */
export function parseHex(input) {
    const s = String(input || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
        return {
            r: parseInt(s[0] + s[0], 16),
            g: parseInt(s[1] + s[1], 16),
            b: parseInt(s[2] + s[2], 16),
        };
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) {
        return {
            r: parseInt(s.slice(0, 2), 16),
            g: parseInt(s.slice(2, 4), 16),
            b: parseInt(s.slice(4, 6), 16),
        };
    }
    return null;
}

/** 相对亮度（0~1） */
export function luminance(hex) {
    const c = parseHex(hex);
    if (!c) {
        return 0;
    }
    const f = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** 在给定底色上"能看清"的文字色（浅底给深字、深底给浅字） */
export function autoTextColor(bgHex) {
    return luminance(bgHex) > 0.5 ? '#1e2024' : '#e6e7e4';
}

/** rgba 字符串（给"浅一点/淡一点"的填充用） */
export function rgba(hex, alpha) {
    const c = parseHex(hex);
    if (!c) {
        return 'rgba(128,128,128,' + String(alpha) + ')';
    }
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + String(alpha) + ')';
}

/** 把外观设置整理成"四个槽位 + 文字色"（缺的按色板补、文字色按亮度算） */
export function resolveAppearance(app) {
    const a = Object.assign({}, DEFAULT_APPEARANCE, app || {});
    const preset = PALETTES[a.palette] || PALETTES[DEFAULT_APPEARANCE.palette];
    const out = {
        palette: PALETTES[a.palette] ? a.palette : DEFAULT_APPEARANCE.palette,
        accent: parseHex(a.accent) ? a.accent : (preset ? preset.accent : DEFAULT_APPEARANCE.accent),
        surface: parseHex(a.surface) ? a.surface : (preset ? preset.surface : DEFAULT_APPEARANCE.surface),
        bg: parseHex(a.bg) ? a.bg : (preset ? preset.bg : DEFAULT_APPEARANCE.bg),
        border: parseHex(a.border) ? a.border : (preset ? preset.border : DEFAULT_APPEARANCE.border),
        applyToPanel: a.applyToPanel !== false,
    };
    out.text = parseHex(a.text) ? a.text : autoTextColor(out.surface);
    return out;
}

/** 选某个预设：把预设的四个槽位写进设置 */
export function palettePatch(key) {
    const preset = PALETTES[key];
    if (!preset) {
        return { palette: 'custom' };
    }
    return {
        palette: key,
        accent: preset.accent,
        surface: preset.surface,
        bg: preset.bg,
        border: preset.border,
    };
}

/**
 * 把外观写成 CSS 变量（挂在指定根节点的 style 上）。
 * 变量名统一 `--wxg-*`，样式表里只认这些，⛔ 不散落硬编码颜色。
 */
export function appearanceVars(app) {
    const a = resolveAppearance(app);
    const isLightSurface = luminance(a.surface) > 0.5;
    const isLightAccent = luminance(a.accent) > 0.42;
    return {
        '--wxg-accent': a.accent,
        '--wxg-accent-ink': isLightAccent ? '#101815' : '#f7f8f7',
        '--wxg-accent-soft': rgba(a.accent, isLightSurface ? 0.14 : 0.18),
        '--wxg-accent-line': rgba(a.accent, 0.55),
        '--wxg-surface': a.surface,
        '--wxg-bg': a.bg,
        '--wxg-text': a.text,
        '--wxg-text-strong': isLightSurface ? '#111317' : '#f3f4f2',
        '--wxg-border': a.border,
        '--wxg-fill': rgba(a.text, 0.07),
        '--wxg-fill-strong': rgba(a.text, 0.13),
        '--wxg-dim': rgba(a.text, 0.62),
        '--wxg-input-bg': isLightSurface ? rgba('#000000', 0.045) : rgba('#000000', 0.22),
        '--wxg-card-bg': isLightSurface ? rgba('#ffffff', 0.75) : rgba(a.text, 0.045),
    };
}

/** 把变量应用到 DOM 节点（用到的变量挂在 node.__wxgVars 上，便于自测与诊断） */
export function applyAppearance(node, app) {
    const vars = appearanceVars(app);
    if (node) {
        node.__wxgVars = vars;
        if (node.style && typeof node.style.setProperty === 'function') {
            for (const k of Object.keys(vars)) {
                node.style.setProperty(k, vars[k]);
            }
        }
    }
    return vars;
}
