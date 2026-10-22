import { describe, expect, it } from 'vitest';
import { 规范化社交列表 } from '../hooks/useGame/stateTransforms';
import { 合并NPC图片档案 } from '../hooks/useGame/npcImageStateWorkflow';

describe('NPC old save compatibility', () => {
    it('repairs teammate combat caps without inventing equipment or bag contents', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'legacy_shen_ruoyan',
                姓名: '沈若嫣',
                性别: '女',
                身份: '青云山庄二小姐',
                境界: '开脉第二重',
                是否队友: true,
                当前血量: 0,
                最大血量: 1,
                当前精力: 72,
                最大精力: 1,
                当前内力: 15,
                最大内力: 1,
                攻击力: 0,
                防御力: 0,
                当前装备: {},
                背包: []
            }
        ], { 合并同名: false });

        expect(npc.最大血量).toBeGreaterThan(1);
        expect(npc.当前血量).toBe(npc.最大血量);
        expect(npc.最大精力).toBeGreaterThanOrEqual(72);
        expect(npc.最大内力).toBeGreaterThanOrEqual(15);
        expect(npc.攻击力).toBeGreaterThan(0);
        expect(npc.防御力).toBeGreaterThan(0);
        expect(npc.当前装备.主武器).toBe('无');
        expect(npc.当前装备.服装).toBe('无');
        expect(npc.背包).toEqual([]);
    });

    it('drops explanatory prose in NPC equipment slots without inferring replacement gear', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_bad_equipment_text',
                姓名: '林婉',
                性别: '女',
                身份: '青云门外门弟子',
                境界: '开脉第一重',
                当前装备: {
                    主武器: '根据她青云门外门弟子的身份，应该生成一柄轻便佩剑。',
                    服装: '服装：青云门外门弟子青衫；饰品：身份腰牌',
                    鞋履: '轻便布靴'
                },
                背包: []
            }
        ], { 合并同名: false });

        expect(npc.当前装备.主武器).toBe('无');
        expect(npc.当前装备.服装).toBe('无');
        expect(npc.当前装备.鞋履).toBe('轻便布靴');
        expect(npc.当前装备.主武器).not.toContain('根据');
        expect(npc.当前装备.服装).not.toContain('服装：');
    });

    it('keeps a newly made bare puppet unequipped until story gives it gear', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_bare_puppet',
                姓名: '陆怀安',
                性别: '男',
                身份: '刚炼制成形的元婴傀儡',
                简介: '刚从炼器台醒来，尚未穿戴衣物，也没有随身物。',
                境界: '通玄境一重',
                当前装备: {},
                背包: []
            }
        ], { 合并同名: false });

        expect(npc.当前装备).toMatchObject({
            主武器: '无',
            副武器: '无',
            服装: '无',
            饰品: '无',
            内衣: '无',
            内裤: '无',
            袜饰: '无',
            鞋履: '无'
        });
        expect(npc.背包).toEqual([]);
    });

    it('derives NPC talents, background and stable non-zero skills from identity when model omitted them', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_healer_major',
                姓名: '苏晚晴',
                性别: '女',
                身份: '药堂医女',
                简介: '常年在药堂照看伤患，也懂得辨识草药。',
                境界: '聚息境中期',
                是否主要角色: true,
                技艺: [
                    { 名称: '炼器', 等级: '未入门', 熟练度: 0 },
                    { 名称: '炼丹', 等级: '未入门', 熟练度: 0 },
                    { 名称: '医术', 等级: '未入门', 熟练度: 0 },
                    { 名称: '阵法', 等级: '未入门', 熟练度: 0 },
                    { 名称: '符箓', 等级: '未入门', 熟练度: 0 },
                    { 名称: '机关', 等级: '未入门', 熟练度: 0 },
                    { 名称: '采集', 等级: '未入门', 熟练度: 0 },
                    { 名称: '鉴定', 等级: '未入门', 熟练度: 0 }
                ]
            }
        ], { 合并同名: false });

        const 医术 = npc.技艺.find((item: any) => item.名称 === '医术');
        const positiveSkills = npc.技艺.filter((item: any) => item.熟练度 > 0);

        expect(npc.境界).toBe('聚息境二重');
        expect(npc.出身背景.名称).toContain('医药');
        expect(npc.天赋列表.length).toBeGreaterThan(0);
        expect(医术).toBeTruthy();
        expect(医术?.熟练度).toBeGreaterThanOrEqual(18);
        expect(positiveSkills.length).toBeGreaterThanOrEqual(2);
        expect(positiveSkills.map((item: any) => item.名称)).not.toEqual(['采集']);
    });

    it('replaces legacy single采集 fallback with bounded ordinary NPC skills', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_ordinary_guard',
                姓名: '赵平安',
                性别: '男',
                身份: '镖局趟子手',
                简介: '负责押车、看货和辨认路上风险。',
                境界: '开脉境一重',
                技艺: [
                    { 名称: '采集', 等级: '入门', 熟练度: 10, 描述: '江湖历练所得。' }
                ]
            }
        ], { 合并同名: false });

        const positiveSkills = npc.技艺.filter((item: any) => item.熟练度 > 0);

        expect(npc.出身背景.名称).toBeTruthy();
        expect(npc.天赋列表.length).toBeGreaterThan(0);
        expect(positiveSkills.length).toBeGreaterThanOrEqual(1);
        expect(Math.max(...positiveSkills.map((item: any) => item.熟练度))).toBeLessThanOrEqual(32);
        expect(positiveSkills.some((item: any) => item.名称 !== '采集' || item.熟练度 !== 10)).toBe(true);
    });

    it('keeps NPC six attributes on the realm budget instead of inflating low realm enemies', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_overstated_enemy',
                姓名: '慕容氏精锐水鬼',
                性别: '男',
                身份: '水鬼精锐',
                境界: '聚息境四重',
                境界层级: 4,
                力量: 14,
                敏捷: 14,
                体质: 14,
                根骨: 17,
                悟性: 4,
                福源: 0
            }
        ], { 合并同名: false });

        const total = npc.力量 + npc.敏捷 + npc.体质 + npc.根骨 + npc.悟性 + npc.福源;

        expect(npc.境界层级).toBe(8);
        expect(total).toBe(37);
        expect(Math.max(npc.力量, npc.敏捷, npc.体质, npc.根骨, npc.悟性, npc.福源)).toBeLessThan(14);
    });

    it('drops dialogue narration fragments that were mistaken for NPC names', () => {
        const list = 规范化社交列表([
            {
                id: 'npc_dialogue_fragment',
                姓名: '她轻声细语地',
                性别: '未知',
                身份: '剧情对话人物',
                对白登场: true,
                自动补全头像: true
            },
            {
                id: 'npc_dialogue_argument_fragment',
                姓名: '只能强辩',
                性别: '未知',
                身份: '剧情对话人物',
                对白登场: true,
                自动补全头像: true
            },
            {
                id: 'npc_su_waner',
                姓名: '苏婉儿',
                性别: '女',
                身份: '贴身侍女',
                是否主要角色: true
            }
        ], { 合并同名: false });

        expect(list).toHaveLength(1);
        expect(list[0].姓名).toBe('苏婉儿');
        expect(list[0].曾用名).toBeUndefined();
    });

    it('drops explicit narration pollution without rewriting the remaining role name', () => {
        const list = 规范化社交列表([
            {
                id: 'npc_bad_name_phrase',
                姓名: '自己已经没有',
                性别: '男',
                身份: '落魄散修',
                简介: '被模型误把正文短语写进姓名字段。',
                是否主要角色: true
            },
            {
                id: 'npc_long_role_name',
                姓名: '慕容氏精锐水鬼',
                性别: '男',
                身份: '水鬼精锐',
                简介: '慕容氏暗线中负责水路伏击的敌手。'
            }
        ], { 合并同名: false });

        expect(list).toHaveLength(1);
        expect(list[0].姓名).toBe('慕容氏精锐水鬼');
        expect(list[0].曾用名).toBeUndefined();
    });

    it('repairs unknown dialogue NPC basics without forcing a gender guess and keeps private closeups out of avatar selection', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_dialogue_half_profile',
                姓名: '许明澈',
                性别: '未知',
                年龄: undefined,
                身份: '未知身份',
                简介: '暂无简介',
                图片档案: {
                    最近生图结果: {
                        id: 'npc_secret_胸部_1',
                        构图: '部位特写',
                        部位: '胸部',
                        状态: 'success',
                        图片URL: 'https://image1.bacon159.pp.ua/api/v1/file/private-chest'
                    },
                    生图历史: [
                        {
                            id: 'npc_secret_胸部_1',
                            构图: '部位特写',
                            部位: '胸部',
                            状态: 'success',
                            图片URL: 'https://image1.bacon159.pp.ua/api/v1/file/private-chest'
                        }
                    ],
                    已选头像图片ID: 'npc_secret_胸部_1'
                }
            }
        ], { 合并同名: false });

        expect(npc.性别).toBe('未知');
        expect(Number.isFinite(npc.年龄)).toBe(true);
        expect(npc.年龄).toBeGreaterThanOrEqual(18);
        expect(npc.身份).not.toBe('未知身份');
        expect(npc.简介).not.toBe('暂无简介');
        expect(npc.图片档案?.已选头像图片ID).toBeUndefined();
        expect(npc.图片档案?.最近生图结果?.构图).toBe('部位特写');
    });

    it('removes unsupported death debuffs from living NPC data', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_bad_death_debuff',
                姓名: '林婉儿',
                性别: '女',
                当前血量: 80,
                最大血量: 100,
                状态: '死亡',
                生死状态: '死亡',
                DEBUFF: [
                    {
                        名称: '死亡',
                        描述: '死亡和绝望的废墟中，心神受到冲击。',
                        效果: '角色已死亡，气血归零，不能继续作为在场行动角色。',
                        结束时间: '永久'
                    },
                    {
                        名称: '惊惧',
                        描述: '目睹废墟惨状后心神不宁。',
                        效果: '行动判定略微下降。'
                    }
                ]
            }
        ], { 合并同名: false });

        expect(npc.当前血量).toBe(80);
        expect(npc.状态).toBeUndefined();
        expect(npc.生死状态).toBeUndefined();
        expect(npc.DEBUFF.map((item: any) => item.名称)).toEqual(['惊惧']);
    });

    it('keeps legacy template-like female major names and completes artifact tags', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_major_waner',
                姓名: '婉儿',
                性别: '女',
                年龄: 18,
                身份: '贴身侍女',
                是否主要角色: true,
                胸部描述: '稳定胸部档案。',
                小穴描述: '稳定小穴档案。',
                屁穴描述: '稳定屁穴档案。'
            }
        ], { 合并同名: false });

        expect(npc.姓名).toBe('婉儿');
        expect(npc.曾用名).toBeUndefined();
        expect(npc.名器档案).toHaveLength(3);
        expect(npc.名器档案.map((item: any) => item.部位)).toEqual(['胸部', '小穴', '屁穴']);
        expect(npc.名器档案.some((item: any) => item.品质 !== '无')).toBe(true);
        expect(npc.名器档案.every((item: any) => item.效果?.说明)).toBe(true);
    });

    it('repairs artifact names from labels and descriptions when the name field is blank', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_major_artifact_names',
                姓名: '若兰',
                性别: '女',
                是否主要角色: true,
                小穴描述: '名器标签：九曲回廊，作为长期私密档案锚点。',
                名器档案: [
                    {
                        部位: '胸部',
                        名称: '',
                        品质: '普通',
                        稳定描述: '胸部拥有“玲珑柔韵”名器标签，作为长期档案与后续判定依据。',
                        效果: {
                            标签: ['玲珑柔韵', '胸部', '名器'],
                            说明: '测试用说明。'
                        }
                    },
                    {
                        部位: '小穴',
                        名称: '未命名名器',
                        品质: '稀有',
                        稳定描述: '',
                        效果: {
                            标签: ['小穴', '名器'],
                            说明: '测试用说明。'
                        }
                    },
                    {
                        部位: '屁穴',
                        品质: '普通',
                        稳定描述: '幽韵天成：作为长期档案与后续判定依据。',
                        效果: {
                            标签: ['屁穴', '名器'],
                            说明: '测试用说明。'
                        }
                    }
                ]
            }
        ], { 合并同名: false });

        const byPart = new Map(npc.名器档案.map((item: any) => [item.部位, item]));
        expect(byPart.get('胸部')?.名称).toBe('玲珑柔韵');
        expect(byPart.get('小穴')?.名称).toBe('九曲回廊');
        expect(byPart.get('屁穴')?.名称).toBe('幽韵天成');
    });

    it('filters impossible femboy vaginal records but keeps anal sex loss', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_femboy_records',
                姓名: '洛溪',
                性别: '男娘',
                是否主要角色: true,
                男娘设定: '女性化气质明显，但身体结构不存在阴道。',
                失贞档案: {
                    是否失贞: true,
                    第一次对象: '杨培强',
                    第一次时间: '四月初二 子时'
                },
                首次亲密记录: [
                    { 类型: '阴道交', 是否已发生: true, 第一次对象: '杨培强' },
                    { 类型: '口交', 是否已发生: true, 第一次对象: '杨培强' },
                    { 类型: '肛交', 是否已发生: true, 第一次对象: '杨培强' }
                ]
            }
        ], { 合并同名: false });

        expect(npc.性别).toBe('男娘');
        expect(npc.失贞档案).toMatchObject({
            是否失贞: true,
            第一次对象: '杨培强',
            第一次时间: '四月初二 子时'
        });
        expect(npc.首次亲密记录.map((item: any) => item.类型)).toEqual(['口交', '肛交']);
    });

    it('keeps weak placeholder social NPC gender unknown instead of forcing a binary guess', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_guard_placeholder',
                姓名: '护院1',
                性别: '未知',
                身份: '剧情对话人物',
                简介: '院门前拦路的一名护院。'
            }
        ], { 合并同名: false });

        expect(npc.性别).toBe('未知');
    });

    it('lets explicit incoming gender evidence overwrite an old wrong placeholder value during merge', () => {
        const [npc] = 规范化社交列表([
            {
                id: 'npc_lin_pozi_old',
                姓名: '林婆子',
                性别: '男',
                身份: '剧情对话人物',
                简介: '先前被错误写成男性。'
            },
            {
                id: 'npc_lin_pozi_new',
                姓名: '林婆子',
                性别: '女',
                身份: '婆子',
                简介: '院中掌灶的老妇人。'
            }
        ]);

        expect(npc.性别).toBe('女');
    });

    it('keeps earlier successful secret part images when a later async write uses an older NPC snapshot', () => {
        const baseNpc = {
            id: 'npc_secret_async',
            姓名: '俞月荷',
            性别: '女',
            是否主要角色: true,
            图片档案: {}
        };
        const vulvaRecord = {
            id: 'npc_secret_vulva',
            部位: '小穴',
            构图: '部位特写',
            状态: 'success',
            图片URL: 'wuxia-asset://img_vulva',
            生成时间: 100
        };
        const anusRecord = {
            id: 'npc_secret_anus',
            部位: '屁穴',
            构图: '部位特写',
            状态: 'success',
            图片URL: 'wuxia-asset://img_anus',
            生成时间: 200
        };

        const afterVulva = {
            ...baseNpc,
            图片档案: 合并NPC图片档案(baseNpc, {
                图片档案: {
                    生图历史: [vulvaRecord],
                    香闺秘档部位档案: { 小穴: vulvaRecord }
                }
            })
        };
        const afterAnusFromStaleSnapshot = 合并NPC图片档案(baseNpc, {
            图片档案: {
                生图历史: [anusRecord, ...(afterVulva.图片档案.生图历史 || [])],
                香闺秘档部位档案: { 屁穴: anusRecord }
            }
        });

        expect(afterAnusFromStaleSnapshot.香闺秘档部位档案?.小穴?.图片URL).toBe('wuxia-asset://img_vulva');
        expect(afterAnusFromStaleSnapshot.香闺秘档部位档案?.屁穴?.图片URL).toBe('wuxia-asset://img_anus');
    });

    it('restores female major NPC secret part archive from successful history during normalization', () => {
        const chestRecord = {
            id: 'npc_secret_chest',
            部位: '胸部',
            构图: '部位特写',
            状态: 'success',
            图片URL: 'wuxia-asset://img_chest',
            生成时间: 100
        };
        const vulvaRecord = {
            id: 'npc_secret_vulva',
            部位: '小穴',
            构图: '部位特写',
            状态: 'success',
            图片URL: 'wuxia-asset://img_vulva',
            生成时间: 200
        };
        const anusRecord = {
            id: 'npc_secret_anus',
            部位: '屁穴',
            构图: '部位特写',
            状态: 'success',
            图片URL: 'wuxia-asset://img_anus',
            生成时间: 300
        };

        const [npc] = 规范化社交列表([
            {
                id: 'npc_secret_female_major',
                姓名: '俞月荷',
                性别: '女',
                是否主要角色: true,
                图片档案: {
                    生图历史: [anusRecord, vulvaRecord, chestRecord],
                    香闺秘档部位档案: {
                        胸部: {
                            id: 'npc_secret_chest_pending',
                            部位: '胸部',
                            构图: '部位特写',
                            状态: 'pending',
                            生图词组: 'old pending prompt',
                            生成时间: 50
                        },
                        屁穴: anusRecord
                    }
                }
            }
        ], { 合并同名: false });

        expect(npc.图片档案?.香闺秘档部位档案?.胸部?.图片URL).toBe('wuxia-asset://img_chest');
        expect(npc.图片档案?.香闺秘档部位档案?.小穴?.图片URL).toBe('wuxia-asset://img_vulva');
        expect(npc.图片档案?.香闺秘档部位档案?.屁穴?.图片URL).toBe('wuxia-asset://img_anus');
    });
});

describe('占位空壳NPC丢弃（陈成/角色9 第3层防御）', () => {
    it('无姓名空壳被兜底成占位名后应被丢弃，不残留“角色N”档案', () => {
        // 模拟越界 set 造出的空壳：只有零星字段、无姓名、无稳定 id。
        const list = 规范化社交列表([
            { 境界: '筑基初期' }
        ], { 合并同名: false });
        expect(list).toHaveLength(0);
    });

    it('已成型的占位名空壳（角色9 + 仅境界）不再保留', () => {
        const list = 规范化社交列表([
            { 姓名: '角色9', 境界: '炼气三层' }
        ], { 合并同名: false });
        expect(list.some((npc: any) => npc?.姓名 === '角色9')).toBe(false);
    });

    it('有稳定 id 和完整档案的真实 NPC 不受影响', () => {
        const list = 规范化社交列表([
            {
                id: 'npc_chen_cheng',
                姓名: '陈成',
                性别: '男',
                身份: '客栈掌柜',
                简介: '经营客栈多年。',
                境界: '炼气五层'
            }
        ], { 合并同名: false });
        expect(list.some((npc: any) => npc?.姓名 === '陈成')).toBe(true);
    });
});
