import { parseStoryRawText } from '../services/ai/storyResponseParser';
import { describe, expect, it } from 'vitest';
import { 执行响应命令处理, 响应命令处理状态 } from '../hooks/useGame/responseCommandProcessor';
import { 规范化社交列表 } from '../hooks/useGame/stateTransforms';
import { 是否可信角色发送者 } from '../utils/dialogueSpeakerGuard';
import { 规范化对白日志 } from '../utils/dialogueLogNormalizer';
import { 校验响应未改写既有NPC姓名 } from '../hooks/useGame/sendWorkflow';

const 构建基础状态 = (): 响应命令处理状态 => ({
    角色: { 姓名: '杨培强' } as any,
    环境: {} as any,
    社交: [],
    世界: {} as any,
    战斗: {} as any,
    玩家门派: {} as any,
    任务列表: [],
    约定列表: [],
    剧情: {} as any,
    剧情规划: {} as any
});

const deps = {
    规范化环境信息: (value?: any) => value || {},
    规范化社交列表,
    规范化世界状态: (value?: any) => value || {},
    规范化战斗状态: (value?: any) => value || {},
    规范化门派状态: (value?: any) => value || {},
    规范化剧情状态: (value?: any) => value || {},
    规范化剧情规划状态: (value?: any) => value || {},
    规范化女主剧情规划状态: (value?: any) => value,
    规范化同人剧情规划状态: (value?: any) => value,
    规范化同人女主剧情规划状态: (value?: any) => value,
    规范化角色物品容器映射: (value?: any) => value || {},
    战斗结束自动清空: (value?: any) => value || {}
};

describe('responseCommandProcessor dialogue social sync', () => {
    it('skips null map layers while decreasing location gender-ratio recovery turns', () => {
        const state = 构建基础状态();
        state.世界 = {
            地图层级: [
                null,
                { ID: 'DT-001', 名称: '碧落峰', 层级: '小地点', 性别比例: '1:5', 性别比例恢复回合: 2, 性别比例变更原因: '临时事件' },
                { ID: 'DT-002', 名称: '青瓦木屋', 层级: '区地点' }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '清晨寒雾压低。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.世界.地图层级[0]).toBeNull();
        expect(result.世界.地图层级[1]).toMatchObject({
            ID: 'DT-001',
            性别比例: '1:5',
            性别比例恢复回合: 1
        });
        expect(result.世界.地图层级[2]).toMatchObject({ ID: 'DT-002' });
    });

    it('allows normal environment time progress but ignores game initial time commands', () => {
        const state = 构建基础状态() as 响应命令处理状态 & { 游戏初始时间?: string };
        state.环境 = { 时间: '1:01:02:08:00' } as any;
        state.游戏初始时间 = '1:01:01:08:00';

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '日头渐高，行程继续。' }
            ],
            tavern_commands: [
                { action: 'set', key: '环境.时间', value: '1:01:03:09:00' },
                { action: 'set', key: '游戏初始时间', value: '1:01:03:09:00' }
            ]
        } as any, state, deps, undefined, { applyState: false }) as any;

        expect(result.环境.时间).toBe('1:01:03:09:00');
        expect(result.游戏初始时间).toBeUndefined();
        expect(state.游戏初始时间).toBe('1:01:01:08:00');
    });

    it('rejects high-level environment location jumps when the story provides no location evidence', () => {
        const state = 构建基础状态();
        state.环境 = {
            时间: '1:01:01:08:00',
            大地点: '大唐',
            中地点: '长安',
            小地点: '西市',
            具体地点: '客栈前厅'
        } as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强仍坐在客栈前厅，与掌柜核对行程。' }
            ],
            tavern_commands: [
                { action: 'set', key: '环境.大地点', value: '大明帝国' },
                { action: 'set', key: '环境.中地点', value: '京师' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.环境.大地点).toBe('大唐');
        expect(result.环境.中地点).toBe('长安');
    });

    it('allows high-level environment location changes when the story explicitly arrives there', () => {
        const state = 构建基础状态();
        state.环境 = {
            时间: '1:01:01:08:00',
            大地点: '大唐',
            中地点: '长安',
            小地点: '西市',
            具体地点: '客栈前厅'
        } as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '传送阵亮起，杨培强穿越界门，抵达大明帝国的京师城门外。' }
            ],
            tavern_commands: [
                { action: 'set', key: '环境.大地点', value: '大明帝国' },
                { action: 'set', key: '环境.中地点', value: '京师' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.环境.大地点).toBe('大明帝国');
        expect(result.环境.中地点).toBe('京师');
    });

    it('does not promote new dialogue speakers into long-term social records without stronger structured evidence', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '院门外有人轻叩。' },
                { sender: '杨青儿', text: '兄长，前厅来客了。' },
                { sender: '杨培强', text: '我这就去。' },
                { sender: '【判定】', text: '无判定。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(0);
    });

    it('keeps existing social NPCs instead of duplicating dialogue speakers', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([{ id: 'npc_yang_qinger', 姓名: '杨青儿', 性别: '女' }], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '杨青儿', text: '兄长。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(1);
        expect(result.社交[0].id).toBe('npc_yang_qinger');
        expect(result.社交[0].对白登场).toBe(true);
        expect(result.社交[0].自动补全头像).toBe(true);
    });

    it('promotes a dialogue speaker into social only when the same turn also contains structured social evidence', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '杨青儿', text: '兄长，前厅来客了。' }
            ],
            tavern_commands: [
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_yang_qinger',
                        姓名: '杨青儿',
                        性别: '女',
                        身份: '杨家族妹',
                        是否在场: true,
                        记忆: []
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(1);
        expect(result.社交[0]).toMatchObject({
            id: 'npc_yang_qinger',
            姓名: '杨青儿',
            性别: '女',
            身份: '杨家族妹',
            是否在场: true,
            对白登场: true,
            自动补全头像: true
        });
    });

    it('filters player self entries from sect important members after commands are applied', () => {
        const state = 构建基础状态();
        state.玩家门派 = {
            名称: '主神小队',
            重要成员: [
                { id: 'member_existing', 姓名: '林雪', 身份: '轮回者' }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '主神空间刷新了轮回者名录。' }
            ],
            tavern_commands: [
                {
                    action: 'set',
                    key: '玩家门派.重要成员',
                    value: [
                        { id: 'sect_member_player_yangpeiqiang', 姓名: '杨培强', 身份: '队长', 是否玩家本人: true },
                        { id: 'member_linxue', 姓名: '林雪', 身份: '轮回者' }
                    ]
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.玩家门派.重要成员.map((member: any) => member.姓名)).toEqual(['林雪']);
    });

    it('adds a child NPC when an adult pregnant character gives birth', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '1:02:01:00:00' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_mother_birth',
                姓名: '沈青棠',
                性别: '女',
                年龄: 24,
                境界: '炼气一层',
                身份: '青云门弟子',
                是否在场: true,
                是否队友: false,
                是否主要角色: true,
                好感度: 80,
                关系状态: '伴侣',
                简介: '已有妊娠档案的成年角色。',
                记忆: [],
                子宫: {
                    状态: '妊娠一月',
                    宫口状态: '妊娠期闭合',
                    内射记录: [],
                    妊娠: {
                        状态: '妊娠一月',
                        受孕时间: '1:01:01:00:00',
                        预计生产时间: '1:11:01:00:00',
                        父亲姓名: '杨培强',
                        已生产: false
                    }
                }
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            body: '沈青棠借时间加速秘法催生，提前生产并诞下一名孩子。',
            logs: [
                { sender: '旁白', text: '沈青棠借时间加速秘法催生，提前生产并诞下一名孩子。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(2);
        expect(result.社交[0].子宫.状态).toBe('产后恢复');
        expect(result.社交[0].子宫.妊娠.已生产).toBe(true);
        expect(result.社交[1]).toMatchObject({
            年龄: 0,
            关系状态: '子嗣'
        });
    });

    it('keeps existing NPCs when AI commands try to delete a social slot', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_shen_qingtang', 姓名: '沈青棠', 性别: '女', 身份: '旧友' }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '沈青棠暂时离开客栈，约定日后再会。' }
            ],
            tavern_commands: [
                { action: 'delete', key: '社交[0]' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(1);
        expect(result.社交[0].id).toBe('npc_shen_qingtang');
        expect(result.社交[0].姓名).toBe('沈青棠');
    });

    it('keeps existing NPCs when AI commands try to replace the whole social list', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_shen_qingtang', 姓名: '沈青棠', 性别: '女', 身份: '旧友' },
            { id: 'npc_lu_mingke', 姓名: '陆明珂', 性别: '女', 身份: '掌柜' }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '陆明珂重新整理账册。' }
            ],
            tavern_commands: [
                {
                    action: 'set',
                    key: '社交',
                    value: [
                        { id: 'npc_lu_mingke', 姓名: '陆明珂', 性别: '女', 身份: '掌柜', 好感度: 15 }
                    ]
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.map((npc: any) => npc.姓名)).toEqual(['沈青棠', '陆明珂']);
        expect(result.社交.find((npc: any) => npc.id === 'npc_lu_mingke')?.好感度).toBe(0);
    });

    it('merges partial social slot object updates without losing the existing NPC name or archive', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_tang_xiaoxue',
                姓名: '棠小雪',
                性别: '女',
                身份: '炼气三层',
                是否主要角色: true,
                简介: '婚约未婚妻，一个月后完婚。',
                胸部描述: '旧胸部档案。',
                记忆: [{ 内容: '与主角有婚约。', 时间: '1:01:01:00:00' }]
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '棠小雪把自己的身体异状讲给杨培强听。' }
            ],
            tavern_commands: [
                {
                    action: 'set',
                    key: '社交[0]',
                    value: {
                        id: 'npc_tang_xiaoxue',
                        胸部描述: '名器 雪肌蕴灵：胸部发育适中，肤若凝脂，乳尖呈淡粉色。',
                        小穴描述: '名器 含羞草：花穴入口极窄且异常敏感。',
                        屁穴描述: '无名器：后庭内壁布满极敏感的神经末梢。'
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(1);
        expect(result.社交[0].姓名).toBe('棠小雪');
        expect(result.社交[0].姓名).not.toBe('角色1');
        expect(result.社交[0].简介).toContain('婚约未婚妻');
        expect(result.社交[0].记忆.map((item: any) => item.内容)).toContain('与主角有婚约。');
        expect(result.社交[0].胸部描述).toContain('雪肌蕴灵');
        expect(result.社交[0].小穴描述).toContain('含羞草');
        expect(result.社交[0].屁穴描述).toContain('无名器');
    });

    it('does not auto-create long-term social NPCs from dialogue alone, even when noise speakers are filtered out', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '只能强辩', text: '我并非有意隐瞒。' },
                { sender: '杨青儿', text: '兄长，先别急。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(0);
    });

    it('filters false dialogue names, but still leaves real speakers to later structured social generation instead of auto-archiving them', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '一边', text: '她提起了桌上的茶盏。' },
                { sender: '热茶倾', text: '杯中雾气散开。' },
                { sender: '俞月荷', text: '这批丹药来得正是时候。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(0);
    });

    it('rejects new social NPC commands when the name never appears in story facts or dialogue', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强沿着山道独行，主线剧情没有其他人物现身。' }
            ],
            tavern_commands: [
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_zhong_yingzheng',
                        姓名: '仲婴筝',
                        性别: '女',
                        身份: '候选池误入人物',
                        是否在场: true,
                        记忆: []
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.map((npc: any) => npc.姓名)).not.toContain('仲婴筝');
        expect(result.社交).toHaveLength(0);
    });

    it('rejects panel names such as team when AI social update commands misclassify them as NPCs', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '系统更新队伍数据，当前没有新的实名同伴加入。' }
            ],
            tavern_commands: [
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_team_panel_noise',
                        姓名: '队伍',
                        性别: '未知',
                        身份: '队伍',
                        是否在场: true,
                        是否队友: true,
                        关系状态: '队友',
                        记忆: []
                    }
                },
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_social_panel_noise',
                        姓名: '社交数据',
                        性别: '未知',
                        身份: '社交',
                        是否在场: true,
                        记忆: []
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.map((npc: any) => npc.姓名)).not.toContain('队伍');
        expect(result.社交.map((npc: any) => npc.姓名)).not.toContain('社交数据');
        expect(result.社交).toHaveLength(0);
    });
});

describe('responseCommandProcessor current scene presence sync', () => {
    it('keeps only NPCs confirmed in the current response as present', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_shen_ruoyan', 姓名: '沈若嫣', 性别: '女', 是否在场: false },
            { id: 'npc_bandit_a', 姓名: '水贼头目', 性别: '男', 是否在场: true },
            { id: 'npc_guard_a', 姓名: '兵器库守卫', 性别: '男', 是否在场: true }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '站在杨培强身侧的沈若嫣，那双清冷的桃花眼中，终于绽放出一抹明亮。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '沈若嫣')?.是否在场).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '水贼头目')?.是否在场).toBe(false);
        expect(result.社交.filter((npc: any) => npc.是否在场 === true).map((npc: any) => npc.姓名)).toEqual(['沈若嫣']);
    });

    it('treats dialogue speakers as present and explicit offscreen mentions as absent', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_yang_qinger', 姓名: '杨青儿', 性别: '女', 是否在场: false },
            { id: 'npc_zhao_pingan', 姓名: '赵平安', 性别: '男', 是否在场: true }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '杨青儿', text: '兄长，账册已经带来了。' },
                { sender: '旁白', text: '赵平安仍在山门外待命，并不在堂中。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '杨青儿')?.是否在场).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '赵平安')?.是否在场).toBe(false);
    });
});

describe('responseCommandProcessor team companion fallback', () => {
    it('marks named present companions as teammates when the story has them follow orders', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_chen_san', 姓名: '陈三', 性别: '男', 身份: '同门弟子', 是否在场: false, 是否队友: false },
            { id: 'npc_li_si', 姓名: '李四', 性别: '男', 身份: '同门弟子', 是否在场: false, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强带着陈三、李四随队潜入水中，沉声命他们出列听令。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '陈三')?.是否队友).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '陈三')?.是否在场).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '李四')?.是否队友).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '李四')?.是否在场).toBe(true);
    });

    it('does not expand unnamed accompanying groups into long-term teammates', () => {
        const state = 构建基础状态();

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强率领十一名满身泥污的精锐弟子一同行动，众人随队听令。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        const companions = result.社交.filter((npc: any) => npc.是否队友 === true);
        expect(companions).toHaveLength(0);
        expect(result.社交.some((npc: any) => /^随行者\d+$/u.test(npc.姓名))).toBe(false);
    });

    it('renames an unnamed follower placeholder when the story later reveals their name', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_companion_old_1', 姓名: '随行者1', 性别: '未知', 身份: '随行者', 是否在场: true, 是否队友: true },
            { id: 'npc_companion_old_2', 姓名: '随行者2', 性别: '未知', 身份: '随行者', 是否在场: true, 是否队友: true }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '顾清河', text: '我来开路。' },
                { sender: '旁白', text: '顾清河明确跟随杨培强同行，与另一名同门一同行动。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        const companions = result.社交.filter((npc: any) => npc.是否队友 === true);
        expect(companions).toHaveLength(2);
        expect(companions.some((npc: any) => npc.姓名 === '顾清河')).toBe(true);
        expect(companions.filter((npc: any) => /^随行者\d+$/.test(npc.姓名))).toHaveLength(1);
    });

    it('does not rename follower placeholders with hostile dialogue senders', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_companion_old_1', 姓名: '随行者1', 性别: '未知', 身份: '随行者', 是否在场: true, 是否队友: true },
            { id: 'npc_enemy_guard', 姓名: '慕容氏守卫', 性别: '男', 身份: '守卫', 是否在场: true, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '慕容氏守卫', text: '站住，休想过去！' },
                { sender: '旁白', text: '慕容氏守卫拔刀拦住去路，敌方阵列围住杨培强。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.id === 'npc_enemy_guard')?.是否队友).toBe(false);
        expect(result.社交.find((npc: any) => npc.id === 'npc_companion_old_1')?.是否队友).toBe(true);
    });

    it('主线人物叙事性带路/护送/跟随不再自动入队（玩家反馈：主线人物全被拉进队伍）', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_murong', 姓名: '慕容雪', 性别: '女', 是否主要角色: true, 是否在场: false, 是否队友: false },
            { id: 'npc_zhaosihai', 姓名: '赵四海', 性别: '男', 身份: '镖头', 是否在场: false, 是否队友: false },
            { id: 'npc_liuxu', 姓名: '柳絮', 性别: '女', 是否在场: false, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '慕容雪领着杨培强穿过月门，在前厅回身行礼。' },
                { sender: '旁白', text: '赵四海护送杨培强前往渡口，随后拱手作别。' },
                { sender: '旁白', text: '柳絮跟着人群涌向码头看热闹。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '慕容雪')?.是否队友).toBe(false);
        expect(result.社交.find((npc: any) => npc.姓名 === '赵四海')?.是否队友).toBe(false);
        expect(result.社交.find((npc: any) => npc.姓名 === '柳絮')?.是否队友).toBe(false);
    });

    it('明确入队证据（结伴同行/追随主角）仍然自动入队', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_suyingxue', 姓名: '苏映雪', 性别: '女', 是否在场: false, 是否队友: false },
            { id: 'npc_qinfeng', 姓名: '秦峰', 性别: '男', 是否在场: false, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '苏映雪答应与杨培强结伴同行，共赴金陵。' },
                { sender: '旁白', text: '秦峰抱拳道：愿追随主角左右，共创一番事业。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '苏映雪')?.是否队友).toBe(true);
        expect(result.社交.find((npc: any) => npc.姓名 === '秦峰')?.是否队友).toBe(true);
    });

    it('短暂同行一段路不入队（CodeRabbit：排除短暂/临时同行事实）', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_murong2', 姓名: '慕容雪', 性别: '女', 是否主要角色: true, 是否在场: false, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '慕容雪只与杨培强短暂同行一段路，随后各自办事。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '慕容雪')?.是否队友).toBe(false);
    });

    it('拒绝结伴同行的邀请不入队（CodeRabbit：排除否定/拒绝语义）', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            { id: 'npc_liuying2', 姓名: '柳莺莺', 性别: '女', 是否在场: false, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '柳莺莺婉拒了结伴同行的邀请，转身独自下山。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.姓名 === '柳莺莺')?.是否队友).toBe(false);
    });
});

describe('responseCommandProcessor corpse death fallback', () => {
    it('marks a clearly bisected corpse as dead when AI provides death commands with cause', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '1:01:02:12:00' } as any;
        state.社交 = 规范化社交列表([
            { id: 'npc_stans', 姓名: '史宾斯', 性别: '男', 当前血量: 42, 最大血量: 80, 状态: '重伤', 是否在场: true, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '史宾斯被一分为二的尸体重重地砸在玻璃地板上，切口焦黑，再无任何生机。史宾斯当场死亡。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' },
                { action: 'set', key: '社交[0].生死状态', value: '死亡' },
                { action: 'set', key: '社交[0].死亡时间', value: '1:01:02:12:00' },
                { action: 'set', key: '社交[0].死亡描述', value: '被一分为二的尸体，切口焦黑，再无任何生机。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(0);
        expect(result.社交[0].状态).toBe('死亡');
        expect(result.社交[0].是否在场).toBe(false);
        expect(result.社交[0].死亡描述).toContain('一分为二');
    });

    it('does not auto-detect death from story text without AI commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '1:01:02:12:00' } as any;
        state.社交 = 规范化社交列表([
            { id: 'npc_stans', 姓名: '史宾斯', 性别: '男', 当前血量: 42, 最大血量: 80, 状态: '重伤', 是否在场: true, 是否队友: false }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '史宾斯被一分为二的尸体重重地砸在玻璃地板上，切口焦黑，再无任何生机。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(42);
        expect(result.社交[0].状态).toBe('重伤');
        expect(result.社交[0].是否在场).toBe(true);
    });
});

describe('responseCommandProcessor female relationship target major role fallback', () => {
    it('marks newly generated female攻略对象 as a major role in the same turn', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强决定把苏晚晴锁定为攻略对象，后续重点推进她的关系线。' }
            ],
            tavern_commands: [
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_su_wanqing',
                        姓名: '苏晚晴',
                        性别: '女',
                        年龄: 19,
                        身份: '新登场的医女',
                        是否在场: true,
                        是否队友: false,
                        是否主要角色: false,
                        好感度: 15,
                        关系状态: '攻略对象',
                        简介: '本回合新登场，并被主角列为攻略目标。',
                        记忆: []
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交.find((npc: any) => npc.id === 'npc_su_wanqing')?.是否主要角色).toBe(true);
    });

    it('does not promote female relationship targets when heroine planning is disabled', () => {
        const state = 构建基础状态();
        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强决定把苏晚晴锁定为攻略对象，后续重点推进她的关系线。' }
            ],
            tavern_commands: [
                {
                    action: 'push',
                    key: '社交',
                    value: {
                        id: 'npc_su_wanqing',
                        姓名: '苏晚晴',
                        性别: '女',
                        是否主要角色: false,
                        关系状态: '攻略对象'
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false, heroinePlanEnabled: false });

        expect(result.社交.find((npc: any) => npc.id === 'npc_su_wanqing')?.是否主要角色).toBe(false);
    });

    it('ignores heroine planning commands when heroine planning is disabled', () => {
        const state = 构建基础状态();
        state.女主剧情规划 = { 现状: '旧规划' } as any;
        state.同人女主剧情规划 = { 现状: '旧同人规划' } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '本回合没有女主规划。' }],
            tavern_commands: [
                { action: 'set', key: '女主剧情规划.现状', value: '新规划' },
                { action: 'set', key: '同人女主剧情规划.现状', value: '新同人规划' }
            ]
        } as any, state, deps, undefined, { applyState: false, heroinePlanEnabled: false });

        expect((result.女主剧情规划 as any)?.现状).toBe('旧规划');
        expect((result.同人女主剧情规划 as any)?.现状).toBe('旧同人规划');
    });

    it('marks an existing female NPC as major when relationship is established by story fact', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '五月初二 夜' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_luo_qingci',
                姓名: '洛青瓷',
                性别: '女',
                年龄: 20,
                身份: '剑阁弟子',
                是否在场: true,
                是否主要角色: false,
                关系状态: '同伴',
                记忆: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '这一夜后，杨培强与洛青瓷正式确立关系，她不再只是普通同伴。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].是否主要角色).toBe(true);
    });
});

describe('responseCommandProcessor NPC death guard', () => {
    it('does not treat zero HP as death without explicit death evidence', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_han_xiaoshuang',
                姓名: '韩小霜',
                性别: '女',
                身份: '折柳山庄外门弟子',
                是否在场: true,
                当前血量: 0,
                最大血量: 174,
                状态: '已故',
                生死状态: '死亡',
                生命状态: '死亡'
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '韩小霜倒在晨课队伍边缘，气血耗尽，只是重伤昏迷，并没有死亡。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.当前血量).toBe(0);
        expect(npc.状态).toBe('重伤');
        expect(npc.生死状态).toBeUndefined();
        expect(npc.生命状态).toBeUndefined();
        expect(npc.死亡描述).toBeUndefined();
    });

    it('only marks a named NPC dead when AI provides explicit death commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '五月初三 午时' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_han_xiaoshuang',
                姓名: '韩小霜',
                性别: '女',
                身份: '折柳山庄外门弟子',
                是否在场: true,
                当前血量: 31,
                最大血量: 174
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '韩小霜被刺客一剑贯穿心口，当场身亡，众人只来得及收殓遗体。韩小霜已死。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' },
                { action: 'set', key: '社交[0].生死状态', value: '死亡' },
                { action: 'set', key: '社交[0].死亡时间', value: '五月初三 午时' },
                { action: 'set', key: '社交[0].死亡描述', value: '韩小霜被刺客一剑贯穿心口，当场身亡。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.状态).toBe('死亡');
        expect(npc.生死状态).toBe('死亡');
        expect(npc.死亡时间).toBe('五月初三 午时');
        expect(npc.死亡描述).toContain('韩小霜');
    });

    it('does not auto-detect death from story text without AI commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '五月初三 午时' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_han_xiaoshuang',
                姓名: '韩小霜',
                性别: '女',
                身份: '折柳山庄外门弟子',
                是否在场: true,
                当前血量: 31,
                最大血量: 174
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '韩小霜被刺客一剑贯穿心口，当场身亡，众人只来得及收殓遗体。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.当前血量).toBe(31);
        expect(npc.状态).toBeUndefined();
        expect(npc.是否在场).toBe(true);
    });

    it('does not mark a lover dead from erotic "要死了" dialogue', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_han_xiaoshuang',
                姓名: '韩小霜',
                性别: '女',
                身份: '恋人',
                是否在场: true,
                当前血量: 88,
                最大血量: 100
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '韩小霜', text: '她抱紧你，喘息着喊了一句“要死了”，随后伏在你怀里平复呼吸。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.当前血量).toBe(88);
        expect(npc.状态).not.toBe('死亡');
        expect(npc.生死状态).toBeUndefined();
        expect((npc.DEBUFF || []).some((item: any) => item?.名称 === '死亡')).toBe(false);
    });

    it('marks a named enemy dead when AI provides death commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '五月初三 午时' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_enemy',
                姓名: '血衣客',
                性别: '男',
                身份: '敌人',
                是否在场: true,
                当前血量: 5,
                最大血量: 100
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '血衣客被你打到陨落，肉身灰飞烟灭，连神魂也随风散尽。血衣客已死。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' },
                { action: 'set', key: '社交[0].生死状态', value: '死亡' },
                { action: 'set', key: '社交[0].死亡时间', value: '五月初三 午时' },
                { action: 'set', key: '社交[0].死亡描述', value: '血衣客被打到陨落，肉身灰飞烟灭，连神魂也随风散尽。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.状态).toBe('死亡');
        expect(npc.生死状态).toBe('死亡');
        expect(npc.死亡描述).toContain('血衣客');
    });

    it('blocks AI commands that create a death debuff from generic death-themed prose', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_lin_waner',
                姓名: '林婉儿',
                性别: '女',
                是否在场: true,
                当前血量: 80,
                最大血量: 100,
                DEBUFF: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '众人踏入死亡和绝望的废墟中，林婉儿脸色发白，却仍跟在队伍后方。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' },
                {
                    action: 'push',
                    key: '社交[0].DEBUFF',
                    value: {
                        名称: '死亡',
                        描述: '死亡和绝望的废墟中，心神受到冲击。',
                        效果: '角色已死亡，气血归零，不能继续作为在场行动角色。',
                        结束时间: '永久'
                    }
                }
            ]
        } as any, state, deps, undefined, { applyState: false });

        const npc = result.社交[0] as any;
        expect(npc.当前血量).toBe(80);
        expect(npc.状态).not.toBe('死亡');
        expect(npc.生死状态).toBeUndefined();
        expect((npc.DEBUFF || []).some((item: any) => item?.名称 === '死亡')).toBe(false);
        expect(npc.是否在场).toBe(true);
    });
});

describe('responseCommandProcessor equipment guard', () => {
    it('blocks silent equipment clearing without an explicit removal trigger', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            装备: {
                头部: '青布头巾',
                主武器: '青钢剑',
                坐骑: '黑马'
            }
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他继续赶路，并未整理行装。' }],
            tavern_commands: [
                { action: 'set', key: '角色.装备', value: { 头部: '无', 主武器: '无', 坐骑: '无' } }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).装备.头部).toBe('青布头巾');
        expect((result.角色 as any).装备.主武器).toBe('青钢剑');
        expect((result.角色 as any).装备.坐骑).toBe('黑马');
    });

    it('allows equipment clearing when the story explicitly says the item was sold or removed', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            装备: {
                主武器: '青钢剑'
            }
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他把青钢剑卖给铁匠，换了几两碎银。' }],
            tavern_commands: [
                { action: 'set', key: '角色.装备.主武器', value: '无' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).装备.主武器).toBe('无');
    });
});

describe('responseCommandProcessor inventory guard', () => {
    it('blocks silent inventory clearing without an explicit removal trigger', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            物品列表: [
                { ID: 'item_sword', 名称: '青钢剑', 数量: 1 },
                { ID: 'item_pill', 名称: '回气丹', 数量: 3 }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他继续赶路，并未整理行囊。' }],
            tavern_commands: [
                { action: 'set', key: '角色.物品列表', value: [] }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).物品列表.map((item: any) => item.名称)).toEqual(['青钢剑', '回气丹']);
    });

    it('preserves inventory when a full role set omits the inventory list', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            境界: '聚息境一重',
            物品列表: [
                { ID: 'item_token', 名称: '门派令牌', 数量: 1 }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他打坐调息，气息更稳。' }],
            tavern_commands: [
                { action: 'set', key: '角色', value: { 姓名: '杨培强', 境界: '聚息境二重' } }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).境界).toBe('聚息境二重');
        expect((result.角色 as any).物品列表.map((item: any) => item.名称)).toEqual(['门派令牌']);
    });

    it('blocks non-array inventory values that would normalize into an empty list', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            物品列表: [
                { ID: 'item_map', 名称: '江南水路图', 数量: 1 }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他观察水路，并未丢弃随身物件。' }],
            tavern_commands: [
                { action: 'set', key: '角色.物品列表', value: '无' },
                { action: 'set', key: '角色', value: { 姓名: '杨培强', 物品列表: null } }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).物品列表.map((item: any) => item.名称)).toEqual(['江南水路图']);
    });

    it('allows inventory clearing when the story explicitly says the items were discarded', () => {
        const state = 构建基础状态();
        state.角色 = {
            姓名: '杨培强',
            物品列表: [
                { ID: 'item_scrap', 名称: '破布条', 数量: 2 }
            ]
        } as any;

        const result = 执行响应命令处理({
            logs: [{ sender: '旁白', text: '他把背包里的破布条全部丢弃，只留下空空的行囊。' }],
            tavern_commands: [
                { action: 'set', key: '角色.物品列表', value: [] }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect((result.角色 as any).物品列表).toEqual([]);
    });
});

describe('responseCommandProcessor NSFW female state fallback', () => {
    it('adds a womb record when explicit internal ejaculation facts are present without commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '三月十五日 夜' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_lin_waner',
                姓名: '林婉儿',
                性别: '女',
                年龄: 18,
                境界: '聚息境三重',
                身份: '师妹',
                是否在场: true,
                是否队友: false,
                是否主要角色: true,
                好感度: 60,
                关系状态: '师妹',
                简介: '活泼清丽的小师妹。',
                记忆: [],
                小穴描述: '无名器：未经人事，花唇闭合得严严实实。',
                是否处女: true,
                子宫: {
                    状态: '未受孕',
                    宫口状态: '紧致',
                    内射记录: []
                }
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '林婉儿', text: '我不行了……' },
                { sender: '旁白', text: '杨培强闷哼一声，精液尽数射入了少女最深处的子宫口。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].子宫.内射记录).toHaveLength(1);
        expect(result.社交[0].子宫.内射记录[0]).toMatchObject({
            日期: '三月十五日 夜',
            怀孕判定日: '三月十五日 夜',
            次数: 1,
            是否生理期: false,
            受孕概率: 0,
            判定结果: '未判定'
        });
        expect(result.社交[0].子宫.内射记录[0].描述).toContain('体内射精事件');
        expect(result.社交[0].是否处女).toBe(false);
        expect(result.社交[0].初夜夺取者).toBe('杨培强');
        expect(result.社交[0].初夜时间).toBe('三月十五日 夜');
        expect(result.社交[0].初夜描述).toContain('初次亲密关系');
        expect(result.社交[0].失贞档案).toMatchObject({
            是否失贞: true,
            第一次对象: '杨培强',
            第一次时间: '三月十五日 夜'
        });
        expect(result.社交[0].首次亲密记录).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    类型: '阴道交',
                    是否已发生: true,
                    第一次对象: '杨培强',
                    第一次时间: '三月十五日 夜'
                })
            ])
        );
        expect(result.社交[0].小穴描述).toContain('原“未经人事”状态失效');
        expect(result.社交[0].小穴描述).not.toContain('未经人事，');
    });

    it('does not duplicate the same inferred womb record when processing is repeated', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '三月十五日 夜' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_lin_waner',
                姓名: '林婉儿',
                性别: '女',
                年龄: 18,
                境界: '聚息境三重',
                身份: '师妹',
                是否在场: true,
                是否队友: false,
                是否主要角色: true,
                好感度: 60,
                关系状态: '师妹',
                简介: '活泼清丽的小师妹。',
                记忆: [],
                子宫: {
                    状态: '未受孕',
                    宫口状态: '紧致',
                    内射记录: [
                        {
                            日期: '三月十五日 夜',
                            描述: '杨培强与其发生体内射精事件：精液尽数射入了少女最深处的子宫口。',
                            怀孕判定日: '待判定'
                        }
                    ]
                }
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强闷哼一声，精液尽数射入了少女最深处的子宫口。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].子宫.内射记录).toHaveLength(1);
    });

    it('does not treat ordinary first-time disclosure text as first-night evidence, even if commands try to write it', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '1:01:12:08:00' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_shen_ruoyan',
                姓名: '沈若嫣',
                性别: '女',
                年龄: 20,
                身份: '书院弟子',
                是否在场: true,
                是否主要角色: true,
                是否处女: true,
                初夜夺取者: '',
                初夜时间: '',
                初夜描述: ''
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '这算是她给出的实质性回报，也是她第一次主动向你透露书院内部的权限变动。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].是否处女', value: false },
                { action: 'set', key: '社交[0].初夜夺取者', value: '杨培强' },
                { action: 'set', key: '社交[0].初夜时间', value: '1:01:12:08:00' },
                { action: 'set', key: '社交[0].初夜描述', value: '杨培强与其发生初次亲密关系：这算是她给出的实质性回报，也是她第一次主动向你透露书院内部的权限变动。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].是否处女).toBe(true);
        expect(result.社交[0].初夜夺取者).toBe('');
        expect(result.社交[0].初夜时间).toBe('');
        expect(result.社交[0].初夜描述).toBe('');
    });

    it('updates first-night and private part state for explicit intercourse facts without ejaculation', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '三月十六日 清晨' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_lin_waner',
                姓名: '林婉儿',
                性别: '女',
                年龄: 18,
                境界: '聚息境三重',
                身份: '师妹',
                是否在场: true,
                是否队友: false,
                是否主要角色: true,
                好感度: 60,
                关系状态: '师妹',
                简介: '活泼清丽的小师妹。',
                记忆: [],
                小穴描述: '无名器：尚未完全开发，未经人事。',
                是否处女: true,
                子宫: {
                    状态: '未受孕',
                    宫口状态: '紧致',
                    内射记录: []
                }
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强进入了林婉儿体内，她的初夜在这一刻成为已发生的事实。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].是否处女).toBe(false);
        expect(result.社交[0].初夜夺取者).toBe('杨培强');
        expect(result.社交[0].初夜时间).toBe('三月十六日 清晨');
        expect(result.社交[0].小穴描述).toContain('原“未经人事”状态失效');
        expect(result.社交[0].子宫.内射记录).toHaveLength(0);
        expect(result.社交[0].失贞档案).toMatchObject({
            是否失贞: true,
            第一次对象: '杨培强',
            第一次时间: '三月十六日 清晨'
        });
        expect(result.社交[0].首次亲密记录).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ 类型: '阴道交', 是否已发生: true, 第一次对象: '杨培强' })
            ])
        );
    });

    it('does not treat imagined explicit scenes as real first intimacy or sex loss', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '1:01:01:00:00' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_qin_yue',
                姓名: '秦月',
                性别: '女',
                年龄: 22,
                身份: '战术队员',
                是否在场: true,
                是否主要角色: true,
                是否处女: true,
                初夜夺取者: '',
                初夜时间: '',
                初夜描述: '',
                失贞档案: { 是否失贞: false },
                首次亲密记录: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '杨培强的目光跟随着秦月的背影，脑海中不由自主地浮现出一些暴烈而粗鄙的画面，想象自己贯穿她的小穴，但现实中他只是握紧拳头，没有真正行动。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].是否处女', value: false },
                { action: 'set', key: '社交[0].初夜夺取者', value: '杨培强' },
                { action: 'set', key: '社交[0].初夜时间', value: '1:01:01:00:00' },
                { action: 'set', key: '社交[0].失贞档案', value: { 是否失贞: true, 第一次对象: '杨培强', 第一次时间: '1:01:01:00:00' } },
                { action: 'set', key: '社交[0].首次亲密记录', value: [{ 类型: '阴道交', 是否已发生: true, 第一次对象: '杨培强' }] }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].是否处女).toBe(true);
        expect(result.社交[0].初夜夺取者).toBe('');
        expect(result.社交[0].初夜时间).toBe('');
        expect(result.社交[0].失贞档案).toMatchObject({ 是否失贞: false });
        expect(result.社交[0].首次亲密记录).toEqual([]);
        expect(result.社交[0].子宫?.内射记录 || []).toEqual([]);
    });

    it('records femboy first anal intimacy as sex loss without vaginal archive', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '四月初二 子时' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_luo_xi',
                姓名: '洛溪',
                性别: '男娘',
                身份: '随行者',
                简介: '纤细漂亮的男娘同伴。',
                是否在场: true,
                是否主要角色: true,
                男娘设定: '女性化气质明显，但身体结构不存在阴道。',
                首次亲密记录: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '这一夜，洛溪第一次口交，也第一次肛交，主动把这些亲密经历交给杨培强。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        const records = result.社交[0].首次亲密记录 || [];
        expect(records).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ 类型: '口交', 是否已发生: true, 第一次对象: '杨培强', 第一次时间: '四月初二 子时' }),
                expect.objectContaining({ 类型: '肛交', 是否已发生: true, 第一次对象: '杨培强', 第一次时间: '四月初二 子时' })
            ])
        );
        expect(records.some((record: any) => record.类型 === '阴道交')).toBe(false);
        expect(result.社交[0].失贞档案).toMatchObject({
            是否失贞: true,
            第一次对象: '杨培强',
            第一次时间: '四月初二 子时'
        });
        expect(result.社交[0].失贞档案.第一次描述).toContain('第一次肛交');
    });
});

describe('responseCommandProcessor NPC death fallback', () => {
    it('sets named dead NPC health and death state when AI provides death commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '四月初一 黄昏' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_zhao_yunting',
                姓名: '赵云廷',
                性别: '男',
                年龄: 28,
                身份: '同门竞争者',
                是否在场: true,
                当前血量: 423,
                最大血量: 423,
                DEBUFF: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '赵云廷被杨培强一剑贯穿心脉，当场身亡。赵云廷已死。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].当前血量', value: 0 },
                { action: 'set', key: '社交[0].状态', value: '死亡' },
                { action: 'set', key: '社交[0].生死状态', value: '死亡' },
                { action: 'set', key: '社交[0].死亡时间', value: '四月初一 黄昏' },
                { action: 'set', key: '社交[0].死亡描述', value: '赵云廷被杨培强一剑贯穿心脉，当场身亡。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(0);
        expect(result.社交[0].状态).toBe('死亡');
        expect(result.社交[0].生死状态).toBe('死亡');
        expect(result.社交[0].是否在场).toBe(false);
        expect(result.社交[0].死亡时间).toBe('四月初一 黄昏');
        expect(result.社交[0].死亡描述).toContain('赵云廷');
    });

    it('does not auto-detect death from story text without AI commands', () => {
        const state = 构建基础状态();
        state.环境 = { 时间: '四月初一 黄昏' } as any;
        state.社交 = 规范化社交列表([
            {
                id: 'npc_zhao_yunting',
                姓名: '赵云廷',
                性别: '男',
                年龄: 28,
                身份: '同门竞争者',
                是否在场: true,
                当前血量: 423,
                最大血量: 423,
                DEBUFF: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '赵云廷被杨培强一剑贯穿心脉，当场身亡。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(423);
        expect(result.社交[0].状态).toBeUndefined();
        expect(result.社交[0].是否在场).toBe(true);
        expect(result.社交[0].DEBUFF.some((item: any) => item?.名称 === '死亡')).toBe(false);
    });

    it('does not mark death for negated or near-death wording', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_zhao_yunting',
                姓名: '赵云廷',
                性别: '男',
                是否在场: true,
                当前血量: 423,
                最大血量: 423,
                DEBUFF: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '赵云廷险些身亡，却终究保住性命，只是重伤倒地。' }
            ],
            tavern_commands: []
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(423);
        expect(result.社交[0].是否在场).toBe(true);
        expect(result.社交[0].DEBUFF.some((item: any) => item?.名称 === '死亡')).toBe(false);
    });

    it('chooses the victim instead of the attacker when AI provides death commands for victim', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_lin_waner',
                姓名: '林婉儿',
                性别: '女',
                是否在场: true,
                当前血量: 200,
                最大血量: 200,
                DEBUFF: []
            },
            {
                id: 'npc_zhao_yunting',
                姓名: '赵云廷',
                性别: '男',
                是否在场: true,
                当前血量: 423,
                最大血量: 423,
                DEBUFF: []
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '林婉儿一剑杀死了赵云廷，血光溅在石阶上。赵云廷已死。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[1].当前血量', value: 0 },
                { action: 'set', key: '社交[1].状态', value: '死亡' },
                { action: 'set', key: '社交[1].死亡时间', value: '四月初一 黄昏' },
                { action: 'set', key: '社交[1].死亡描述', value: '被林婉儿一剑杀死。' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].当前血量).toBe(200);
        expect(result.社交[0].状态).toBeUndefined();
        expect(result.社交[0].是否在场).toBe(true);
        expect(result.社交[1].当前血量).toBe(0);
        expect(result.社交[1].状态).toBe('死亡');
        expect(result.社交[1].是否在场).toBe(false);
    });

    // 陈成/角色9 修复：防止无姓名空壳社交条目（会被兜底成"角色N"，与对话框真名对不上）
    it('丢弃越界 set 社交[N].子字段命令，不再凭空生成无姓名空壳', () => {
        const state = 构建基础状态();
        state.社交 = [
            { id: 'npc_liuyan', 姓名: '柳烟', 性别: '女', 身份: '客栈掌柜', 境界: '炼气三层' }
        ] as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '柳烟擦着桌子。' }
            ],
            tavern_commands: [
                // 社交只有 1 项，索引 9 越界：applyStateCommand 会造出 社交[1..9] 空壳
                { action: 'set', key: '社交[9].当前位置', value: '客栈前厅' },
                { action: 'set', key: '社交[9].境界', value: '筑基初期' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        // 只应保留原有 1 项，不产生任何"角色N"空壳
        expect(result.社交).toHaveLength(1);
        expect(result.社交[0].姓名).toBe('柳烟');
        expect(JSON.stringify(result.社交)).not.toMatch(/角色\d/);
    });

    it('丢弃缺姓名的整体 push 社交命令，不再生成无姓名空壳', () => {
        const state = 构建基础状态();
        state.社交 = [] as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '一名灰衣人站在角落。' }
            ],
            tavern_commands: [
                // 整体新增社交对象但漏写姓名 → 会被兜底成"角色0"
                { action: 'push', key: '社交', value: { 境界: '炼气五层', 身份: '灰衣人' } }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(0);
        expect(JSON.stringify(result.社交)).not.toMatch(/角色\d/);
    });

    it('允许把占位名"角色N"改成对话框真名，回填进社交档案', () => {
        const state = 构建基础状态();
        // 模拟历史遗留的占位空壳：姓名已被兜底成"角色9"，但有实质档案
        state.社交 = [
            { id: 'npc_role9', 姓名: '角色9', 性别: '男', 身份: '散修', 境界: '金丹初期', 是否主要角色: true }
        ] as any;

        const result = 执行响应命令处理({
            logs: [
                { sender: '陈成', text: '“在下陈成，有礼了。”' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].姓名', value: '陈成' }
            ]
        } as any, state, deps, undefined, { applyState: false });

        const 陈成 = result.社交.find((npc: any) => npc?.姓名 === '陈成');
        expect(陈成).toBeTruthy();
        expect(JSON.stringify(result.社交)).not.toMatch(/角色9/);
    });

    it('把整体 add 社交对象按追加命令执行，并保持既有 NPC 境界守卫索引', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_xie_bin',
                姓名: '谢斌',
                性别: '男',
                境界: '聚息境四重',
                境界层级: 8,
                是否队友: true,
                是否在场: true
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '林岳', text: '“我与诸位同行。”' },
                { sender: '旁白', text: '林岳加入队伍，谢斌境界没有变化。' }
            ],
            tavern_commands: [
                {
                    action: 'add',
                    key: '社交',
                    value: { id: 'npc_lin_yue', 姓名: '林岳', 性别: '男', 境界: '开脉境一重', 境界层级: 1 }
                },
                { action: 'set', key: '社交[0].境界层级', value: 1 }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交).toHaveLength(2);
        expect(result.社交[0].姓名).toBe('谢斌');
        expect(result.社交[0].境界层级).toBe(8);
        expect(result.社交[1].姓名).toBe('林岳');
    });

    it('丢弃同一 NPC 的整组无依据境界回退命令，但保留同回合其他合法更新', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_xie_bin',
                姓名: '谢斌',
                性别: '男',
                境界: '聚息境四重',
                境界层级: 8,
                是否队友: true,
                是否在场: true,
                好感度: 40
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '谢斌与众人继续赶路，本回合没有发生境界变化。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].境界', value: '开脉境初期' },
                { action: 'set', key: '社交[0].境界层级', value: 1 },
                { action: 'add', key: '社交[0].好感度', value: 2 }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].境界).toBe('聚息境四重');
        expect(result.社交[0].境界层级).toBe(8);
        expect(result.社交[0].好感度).toBe(42);
    });

    it('正文明确永久跌境时允许同步更新 NPC 境界文案和层级', () => {
        const state = 构建基础状态();
        state.社交 = 规范化社交列表([
            {
                id: 'npc_xie_bin',
                姓名: '谢斌',
                性别: '男',
                境界: '聚息境四重',
                境界层级: 8,
                是否队友: true,
                是否在场: true
            }
        ], { 合并同名: false });

        const result = 执行响应命令处理({
            logs: [
                { sender: '旁白', text: '谢斌逆转经脉救下众人，修为被彻底废去，境界永久跌落至开脉境一重。' }
            ],
            tavern_commands: [
                { action: 'set', key: '社交[0].境界', value: '开脉境一重' },
                { action: 'set', key: '社交[0].境界层级', value: 1 }
            ]
        } as any, state, deps, undefined, { applyState: false });

        expect(result.社交[0].境界).toBe('开脉境一重');
        expect(result.社交[0].境界层级).toBe(1);
    });
});


describe('多语言 NPC 新增与保留', () => {
    const names = ['Alice', 'Emily Carter', 'Alex Morgan', 'Jean-Luc', "O'Connor", 'O’Connor', 'José Álvarez', 'He Ping'];
    it.each(names)('从 AI 响应新增并保留 %s 的显示格式', (name) => {
        const response = parseStoryRawText(`<正文>\n【${name}】“你好。”\n</正文>\n<命令>\npush 社交 = ${JSON.stringify({ id: 'NPC-MULTILINGUAL', 姓名: name, 性别: '女', 身份: '旅人', 简介: '来自远方' })}\n</命令>`);
        const state = 执行响应命令处理(response, 构建基础状态(), deps, undefined, { applyState: false });
        expect(state.社交).toHaveLength(1);
        expect(state.社交[0]).toMatchObject({ 姓名: name, 对白登场: true });
        let social = state.社交;
        for (let i = 0; i < 5; i++) social = 规范化社交列表(social, { 合并同名: false });
        expect(social.map(npc => npc.姓名)).toEqual([name]);
    });
    it.each([
        ['Emily Carter', 'Emily Carter'], ['Emily Carter', 'emily carter'],
        ["O'Connor", 'O’Connor'], ['O’Connor', "O'Connor"],
        ['José Álvarez', 'José Álvarez'],
    ])('旁白 %s 为命令姓名 %s 提供新增依据', (bodyName, commandName) => {
        const state = 执行响应命令处理({ logs: [{ sender: '旁白', text: `${bodyName} 走进大厅。` }], tavern_commands: [{ action: 'push', key: '社交', value: { 姓名: commandName, 性别: '女', 身份: '旅人' } }] } as any, 构建基础状态(), deps, undefined, { applyState: false });
        expect(state.社交.map(npc => npc.姓名)).toEqual([commandName]);
    });
    it('不把 Alex 模糊匹配成 Alexander', () => {
        const state = 执行响应命令处理({ logs: [{ sender: '旁白', text: 'Alexander 走进大厅。' }], tavern_commands: [{ action: 'push', key: '社交', value: { 姓名: 'Alex', 身份: '旅人' } }] } as any, 构建基础状态(), deps, undefined, { applyState: false });
        expect(state.社交).toEqual([]);
    });
    it.each(['未命名NPC', '角色1', 'NPC3', '自己已经没有', 'Alice\u0000', '<Alice>', '社交'])('拒绝占位或污染姓名 %s', name => {
        const state = 执行响应命令处理({ logs: [{ sender: '旁白', text: `${name} 出现。` }], tavern_commands: [{ action: 'push', key: '社交', value: { 姓名: name } }] } as any, 构建基础状态(), deps, undefined, { applyState: false });
        expect(state.社交).toEqual([]);
    });
    it.each(['阿卡菲尔', '阿尔得文'])('中文真实姓名 %s 不再仅因姓氏表缺失被删除', name => {
        const list = 规范化社交列表([{ 姓名: name, 对白登场: true, 自动补全头像: true }]);
        expect(规范化社交列表(list).map(npc => npc.姓名)).toEqual([name]);
    });
});


it('完整档案也不能用尾部控制字符绕过新增姓名校验', () => {
    const state = 执行响应命令处理({ logs: [{ sender: 'Alice', text: '“你好。”' }], tavern_commands: [{ action: 'push', key: '社交', value: { id: 'NPC-CONTROL', 姓名: 'Alice\n', 身份: '旅人', 简介: '完整档案' } }] } as any, 构建基础状态(), deps, undefined, { applyState: false });
    expect(state.社交).toEqual([]);
});

describe('NPC 姓名最终写入防护', () => {
    it.each(['未命名NPC', '角色1', 'NPC3'])('完整档案的新占位名 %s 仍不能写入', name => {
        const response = { logs: [{ sender: '旁白', text: `${name}出现。` }], tavern_commands: [
            { action: 'push', key: '社交', value: { id: 'NPC-PLACEHOLDER', 姓名: name, 身份: '旅人', 简介: '完整档案' } }
        ] } as any;
        expect(执行响应命令处理(response, 构建基础状态(), deps, undefined, { applyState: false }).社交).toEqual([]);
    });
    it.each(['She walks away', 'He looked at me', '她低声说hello', '缓缓走进', 'A--B', '社交列表', '<Alice>', 'Alice=Bob'])('%s 不会通过 sender、命令或完整档案变成 NPC', name => {
        expect(是否可信角色发送者(name)).toBe(false);
        expect(是否可信角色发送者(name, { declaredNames: new Set([name]) })).toBe(false);
        expect(规范化对白日志([{ sender: name, text: '“你好。”' }]).some(log => log.sender === name)).toBe(false);
        const npc = { id: 'NPC-NOISE', 姓名: name, 身份: '旅人', 简介: '完整档案' };
        const parsed = parseStoryRawText(`<正文>\n【${name}】“你好。”\n【旁白】${name} 出现。\n</正文>\n<命令>\npush 社交 = ${JSON.stringify(npc)}\n</命令>`);
        expect(执行响应命令处理(parsed, 构建基础状态(), deps, undefined, { applyState: false }).社交).toEqual([]);
        for (const command of [
            { action: 'set', key: '社交[0]', value: npc },
            { action: 'set', key: '社交', value: [npc] }
        ]) {
            expect(执行响应命令处理({ logs: [{ sender: '旁白', text: `${name} 出现。` }], tavern_commands: [command] } as any,
                构建基础状态(), deps, undefined, { applyState: false }).社交).toEqual([]);
        }
        expect(规范化社交列表([npc])).toEqual([]);
        expect(规范化社交列表([{ ...npc, 对白登场: true, 自动补全头像: true }])).toEqual([]);
    });
    it('整体 set 同 ID 改名被主剧情重试校验和最终执行双重拦截', () => {
        const base = 构建基础状态();
        base.社交 = [{ id: 'NPC001', 姓名: '江婉', 身份: '友人' }] as any;
        const response = { logs: [{ sender: '旁白', text: '苏婉清走进大厅。' }], tavern_commands: [
            { action: 'set', key: '社交', value: [{ id: 'NPC001', 姓名: '苏婉清', 身份: '友人' }] }
        ] } as any;
        expect(() => 校验响应未改写既有NPC姓名(response, base.社交, '原始正文')).toThrow('改写');
        try { 校验响应未改写既有NPC姓名(response, base.社交, '原始正文'); } catch (error: any) {
            expect(error.name).toBe('StoryResponseParseError');
        }
        expect(执行响应命令处理(response, base, deps, undefined, { applyState: false }).社交.map(npc => npc.姓名)).toEqual(['江婉']);
    });
    it.each(['名称', 'name'])('整体 set 使用 %s 别名字段不能绕过稳定 ID 改名保护', field => {
        const base = 构建基础状态();
        base.社交 = [{ id: 'NPC001', 姓名: '江婉', 身份: '友人' }] as any;
        const response = { logs: [], tavern_commands: [{ action: 'set', key: '社交', value: [{ id: 'NPC001', [field]: '苏婉清' }] }] } as any;
        expect(() => 校验响应未改写既有NPC姓名(response, base.社交, '')).toThrow('改写');
        expect(执行响应命令处理(response, base, deps, undefined, { applyState: false }).社交.map(npc => npc.姓名)).toEqual(['江婉']);
    });
    it('整体 set 重排已有 NPC 继续允许且保留显示格式', () => {
        const base = 构建基础状态();
        base.社交 = [{ id: 'NPC001', 姓名: 'Emily Carter', 身份: '旅人' }, { id: 'NPC002', 姓名: '江婉', 身份: '友人' }] as any;
        const response = { logs: [], tavern_commands: [{ action: 'set', key: '社交', value: [base.社交[1], { ...base.社交[0], 姓名: 'emily carter' }] }] } as any;
        expect(() => 校验响应未改写既有NPC姓名(response, base.社交, '')).not.toThrow();
        expect(执行响应命令处理(response, base, deps, undefined, { applyState: false }).社交.map(npc => npc.姓名)).toEqual(['江婉', 'Emily Carter']);
    });
    it.each(['push', 'slot', 'array', 'name', 'final'])('主角 O\'Connor 的弯撇号变体在 %s 路径不会留在社交', path => {
        const base = 构建基础状态();
        base.角色.姓名 = "O'Connor";
        const npc = { id: 'NPC001', 姓名: 'O’Connor', 身份: '旅人' };
        let commands: any[] = [];
        if (path === 'push') commands = [{ action: 'push', key: '社交', value: npc }];
        if (path === 'slot') commands = [{ action: 'set', key: '社交[0]', value: npc }];
        if (path === 'array') commands = [{ action: 'set', key: '社交', value: [npc] }];
        if (path === 'name') {
            base.社交 = [{ ...npc, 姓名: '角色9' }] as any;
            commands = [{ action: 'set', key: '社交[0].姓名', value: npc.姓名 }];
        }
        if (path === 'final') base.社交 = [npc] as any;
        const response = { logs: [{ sender: '旁白', text: 'O’Connor 走进大厅。' }], tavern_commands: commands } as any;
        expect(执行响应命令处理(response, base, deps, undefined, { applyState: false }).社交).toEqual([]);
        if (path === 'final') {
            expect(执行响应命令处理({ logs: [] } as any, base, deps, undefined, { applyState: false }).社交).toEqual([]);
        }
    });
    it('主角 Emily Carter 与 NPC EmilyCarter 保持不同身份', () => {
        const base = 构建基础状态();
        base.角色.姓名 = 'Emily Carter';
        const response = { logs: [{ sender: 'EmilyCarter', text: '“你好。”' }], tavern_commands: [
            { action: 'push', key: '社交', value: { id: 'NPC001', 姓名: 'EmilyCarter', 身份: '旅人' } }
        ] } as any;
        expect(执行响应命令处理(response, base, deps, undefined, { applyState: false }).社交.map(npc => npc.姓名)).toEqual(['EmilyCarter']);
    });
    it.each(['field', 'slot', 'array', 'push'])('已有显示姓名在 %s 更新中保持原样', path => {
        const base = 构建基础状态();
        base.社交 = [{ id: 'NPC001', 姓名: 'Emily Carter', 身份: '旅人' }] as any;
        const npc = { ...base.社交[0], 姓名: 'emily carter', 好感度: 20 };
        const commands = path === 'field' ? [{ action: 'set', key: '社交[0].姓名', value: npc.姓名 }]
            : [{ action: path === 'push' ? 'push' : 'set', key: path === 'slot' ? '社交[0]' : '社交', value: path === 'array' ? [npc] : npc }];
        const result = 执行响应命令处理({ logs: [], tavern_commands: commands } as any, base, deps, undefined, { applyState: false });
        expect(result.社交.map(npc => npc.姓名)).toEqual(['Emily Carter']);
    });
});
