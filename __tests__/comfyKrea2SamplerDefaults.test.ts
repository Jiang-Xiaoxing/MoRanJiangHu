import { describe, expect, it } from 'vitest';
import { __测试__构建ComfyUI工作流 } from '../services/ai/imageTasks';

const buildWorkflow = (nodes: Record<string, unknown>): string => JSON.stringify({
    sampler: {
        class_type: 'KSampler',
        inputs: {
            seed: '__SEED__',
            steps: '__STEPS__',
            cfg: '__CFG__',
            sampler_name: '__SAMPLER__',
            scheduler: '__SCHEDULER__'
        }
    },
    ...nodes
});

const readSampler = (workflowText: string, pngParams?: Record<string, unknown>) => {
    const result = __测试__构建ComfyUI工作流(
        workflowText,
        'portrait',
        'text',
        1024,
        1024,
        pngParams as any
    ) as any;
    return result.sampler.inputs;
};

describe('ComfyUI 采样参数默认值启发式', () => {
    // Moody Krea2 Mix 实况：CLIPLoader type "krea2"，但 VAE/文本编码器用的是 qwen 系文件。
    // krea2 分支必须优先于 qwen 分支，否则 20 步/cfg 2.5 会烤出噪点且低显存下耗时翻倍。
    const krea2Workflow = buildWorkflow({
        loader: {
            class_type: 'CLIPLoader',
            inputs: { clip_name: 'moodyKrea2Mix_v70_nvfp4.safetensors', type: 'krea2' }
        },
        vae: {
            class_type: 'VAELoader',
            inputs: { vae_name: 'qwen_image_vae.safetensors' }
        }
    });

    it('krea2 工作流命中作者配方 8 步/cfg 1/euler/simple（且优先于 qwen 标记）', () => {
        const inputs = readSampler(krea2Workflow);
        expect(inputs.steps).toBe(8);
        expect(inputs.cfg).toBe(1);
        expect(inputs.sampler_name).toBe('euler');
        expect(inputs.scheduler).toBe('simple');
    });

    it('krea2 工作流上显式 PNG 参数仍优先', () => {
        const inputs = readSampler(krea2Workflow, { 步数: 12, CFG强度: 1.5, 采样器: 'dpmpp_2m', 噪声计划: 'karras' });
        expect(inputs.steps).toBe(12);
        expect(inputs.cfg).toBe(1.5);
        expect(inputs.sampler_name).toBe('dpmpp_2m');
        expect(inputs.scheduler).toBe('karras');
    });

    it('无标记的通用工作流保持 28 步/cfg 7/euler/normal', () => {
        const inputs = readSampler(buildWorkflow({
            loader: {
                class_type: 'CheckpointLoaderSimple',
                inputs: { ckpt_name: 'some_sdxl_model.safetensors' }
            }
        }));
        expect(inputs.steps).toBe(28);
        expect(inputs.cfg).toBe(7);
        expect(inputs.sampler_name).toBe('euler');
        expect(inputs.scheduler).toBe('normal');
    });

    it('zImageTurbo 工作流保持 9 步/cfg 1/res_multistep/sgm_uniform', () => {
        const inputs = readSampler(buildWorkflow({
            loader: {
                class_type: 'CLIPLoader',
                inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'zImageTurbo' }
            }
        }));
        expect(inputs.steps).toBe(9);
        expect(inputs.cfg).toBe(1);
        expect(inputs.sampler_name).toBe('res_multistep');
        expect(inputs.scheduler).toBe('sgm_uniform');
    });

    it('qwen image 工作流保持 20 步/cfg 2.5/euler/simple', () => {
        const inputs = readSampler(buildWorkflow({
            loader: {
                class_type: 'CLIPLoader',
                inputs: { clip_name: 'qwen_image_fp8_e4m3fn.safetensors' }
            }
        }));
        expect(inputs.steps).toBe(20);
        expect(inputs.cfg).toBe(2.5);
        expect(inputs.sampler_name).toBe('euler');
        expect(inputs.scheduler).toBe('simple');
    });
});
