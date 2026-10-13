/**
 * 万象阁 · 常量与默认值
 *
 * 本文件不导入任何酒馆内部模块，纯数据，便于单独检查。
 */

/** 正式名称（标题、界面名统一用它） */
export const APP_NAME = '万象阁';

/** 面板挂在扩展设置区里的容器 id */
export const ROOT_ID = 'wanxiangge-root';

/** 卡片挂载用的消息标记属性 */
export const CARD_ATTR = 'data-wxg-card';

/** 卡片样式类名前缀 */
export const CARD_CLASS = 'wxg-card';

/** 全局设置键（存在酒馆的扩展设置里，随账号持久化） */
export const SETTINGS_KEY = 'wanxiangge';

/** 运行账本键（存在当前聊天的元数据里，按聊天各分各的） */
export const LEDGER_KEY = 'wanxiangge';

/** 设置结构版本 */
export const SETTINGS_VERSION = 1;

/** 账本结构版本 */
export const LEDGER_VERSION = 1;

/** 账本里最多留多少条召回记录（软上限，超出丢最旧的） */
export const RECALL_LOG_LIMIT = 200;

/** 单张卡片最多显示几行人物状态 */
export const CARD_CHAR_LIMIT = 12;

/** 预设人物名册（开局先立起来的十来个角色，一次点击写入，之后可随意增删改） */
export const ROSTER_PRESET = [
    '吉尔伯特·冯·海姆',
    '塞西莉亚',
    '雷欧·阿斯特拉',
    '伊莎贝拉',
    '阿德里安·克劳德',
    '莉薇娅',
    '罗德里克',
    '菲奥娜',
    '艾伦·维斯特',
    '米拉',
    '卡尔·斯特恩',
    '娜塔莉亚',
];

/** 全局设置默认值 */
export const DEFAULT_SETTINGS = Object.freeze({
    version: SETTINGS_VERSION,
    enabled: true,          // 总开关
    cardEnabled: true,      // 是否在用户回复楼后挂卡片
    recentTurns: 3,         // 线索回溯几楼（她的最新发言 + 前面几楼正文）
    maxChars: 8,            // 召回人物条数封顶
    maxEvents: 6,           // 召回世界事件条数封顶（第 3 步起生效）
    strictMention: false,   // 只召回本轮发言被点名的人（严格模式）
    sortMode: 'related',    // related＝按相关度重排；name＝按名册顺序
    injectHeader: '【万象阁·系统附注】以下是引擎自动附上的既定事实（不是角色台词、不是新输入），写正文时据此保持一致，不要复述本段。',
    protectedBypass: true,  // 现场保护：正文里刚演过的人，本轮只带好感，不重复推演
    updateEvery: 1,         // 每 N 回合更新一次账（第 3 步起生效）
    showEmptyCard: true,    // 没有召回时也显示空态卡片
    roster: [],             // 人物名册（按聊天各分各的，见 settings.js 说明）
});
