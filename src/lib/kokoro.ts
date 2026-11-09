/**
 * Kokoro 本地神经网络语音（kokoro-js + Transformers.js）
 *
 * 模型、音色文件和 onnxruntime wasm 都放在 public/ 下，完全离线运行。
 * 这里做了懒加载、进度反馈和音频播放；失败由调用方回退系统语音。
 */
import { reactive } from 'vue';
import type { KokoroTTS } from 'kokoro-js';
import { toast, toastMessage } from '../store/toast';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 0.95;
const BASE = import.meta.env.BASE_URL;
const MODEL_ROOT = `${BASE}models/kokoro/`;
const VOICE_ROOT = `${BASE}models/kokoro/voices/`;
// 用绝对 URL，避免 Vite 对 public 目录里的 .mjs 动态导入做二次处理
const ORT_BASE = () => new URL(`${BASE}ort/`, window.location.href).href;
const VOICE_CACHE = 'kokoro-voices';
const HF_VOICE_URL = (voice: string) =>
  `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${voice}.bin`;
const MAX_AUDIO_CACHE = 160;
const LOADING_TOAST = '正在加载本地 Kokoro 语音模型（约 90MB）…';
/** 加载超过这个时间就当作失败，避免提示卡在“加载中”不动 */
const LOAD_TIMEOUT_MS = 15000;

export type KokoroPhase = 'idle' | 'loading' | 'ready' | 'error';

export const kokoroState = reactive<{
  phase: KokoroPhase;
  progress: number;
  text: string;
}>({
  phase: 'idle',
  progress: 0,
  text: 'Kokoro 模型尚未加载，首次使用会自动加载本地模型',
});

let instance: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
let audioContext: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let playSeq = 0;
const preparedVoices = new Set<string>();
/** 已生成的 WAV，避免同一个单词每次都重新推理（单次推理约 1~2 秒） */
const audioCache = new Map<string, ArrayBuffer>();
/** 同一单词的并发请求共享一次生成 */
const pendingAudio = new Map<string, Promise<ArrayBuffer>>();

// 热更新后可能残留上一次的常驻“正在加载”提示，这里顺手清掉，避免看起来一直卡在加载
if (toastMessage.value.startsWith('正在加载') || toastMessage.value.startsWith('模型文件已就绪')) {
  toast('');
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function isKokoroReady(): boolean {
  return !!instance;
}

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function stopPlayback(): void {
  if (!source) return;
  try {
    source.stop();
  } catch {
    /* 已结束 */
  }
  source = null;
}

/** 让 kokoro-js 从本地 public/ 读取音色文件，而不是请求 Hugging Face */
async function ensureVoiceCached(voice: string): Promise<void> {
  if (preparedVoices.has(voice) || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(VOICE_CACHE);
    const key = HF_VOICE_URL(voice);
    if (await cache.match(key)) {
      preparedVoices.add(voice);
      return;
    }
    console.log(`[kokoro] 缓存 ${voice} 到 ${key}`);
    const res = await fetch(`${VOICE_ROOT}${voice}.bin`);
    if (!res.ok) throw new Error(`voice ${voice} not found (${res.status})`);
    await cache.put(
      key,
      new Response(await res.arrayBuffer(), {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    );
    preparedVoices.add(voice);
  } catch (err) {
    // 缓存失败不致命，继续交给 kokoro-js 处理
    console.warn('[kokoro] 音色本地缓存失败', err);
  }
}

function audioKey(text: string, voice: string, speed: number): string {
  return `${voice}|${speed}|${text}`;
}

/** 生成或复用某个单词的 WAV；同一单词并发只推理一次 */
function getOrCreateWav(
  text: string,
  voice: string,
  speed: number
): Promise<ArrayBuffer> {
  const key = audioKey(text, voice, speed);
  const cached = audioCache.get(key);
  if (cached) {
    // 刷新 LRU 顺序
    audioCache.delete(key);
    audioCache.set(key, cached);
    return Promise.resolve(cached);
  }

  const pending = pendingAudio.get(key);
  if (pending) return pending;

  const task = (async () => {
    const [tts] = await Promise.all([loadKokoro(), ensureVoiceCached(voice)]);
    const startedAt = performance.now();
    const audio = await tts.generate(text, { voice: voice as never, speed });
    console.debug(
      `[kokoro] 合成 "${text}" 用时 ${Math.round(performance.now() - startedAt)}ms`
    );
    const wav = audio.toWav();
    audioCache.set(key, wav);
    while (audioCache.size > MAX_AUDIO_CACHE) {
      const oldest = audioCache.keys().next().value;
      if (oldest === undefined) break;
      audioCache.delete(oldest);
    }
    return wav;
  })();

  pendingAudio.set(key, task);
  return task.finally(() => pendingAudio.delete(key));
}

/** 提前生成发音（通常在卡片出现时调用），点击朗读时直接命中缓存 */
export function prefetchKokoro(
  text: string,
  voice = DEFAULT_VOICE,
  speed = DEFAULT_SPEED
): Promise<void> {
  if (!text) return Promise.resolve();
  return getOrCreateWav(text, voice, speed).then(
    () => {},
    (err) => {
      console.warn('[kokoro] 预生成发音失败', err);
    }
  );
}

/** 加载模型；并发调用会复用同一个 Promise */
export function loadKokoro(): Promise<KokoroTTS> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  kokoroState.phase = 'loading';
  kokoroState.progress = 0;
  kokoroState.text = '正在加载 Kokoro 语音模型…';
  toast(LOADING_TOAST, 0);

  const files = new Map<string, { loaded: number; total: number }>();
  const startedAt = performance.now();

  loading = (async () => {
    const [{ KokoroTTS }, { env }] = await Promise.all([
      import('kokoro-js'),
      import('@huggingface/transformers'),
    ]);

    // 全部走本地文件，避免访问 Hugging Face 和 CDN
    env.localModelPath = MODEL_ROOT;
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.useBrowserCache = false;

    const wasmEnv = env.backends.onnx.wasm;
    const onProgress = (p: {
      status: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      kokoroState.progress = pct;
      kokoroState.text =
        pct >= 100
          ? '模型文件已就绪，正在初始化语音引擎…'
          : `正在加载模型 ${pct}%（约 ${(total / 1048576).toFixed(0)} MB）`;
      toast(kokoroState.text, 0);
    };

    const build = (proxy: boolean) => {
      if (wasmEnv) {
        wasmEnv.wasmPaths = {
          wasm: `${ORT_BASE()}ort-wasm-simd-threaded.jsep.wasm`,
          mjs: `${ORT_BASE()}ort-wasm-simd-threaded.jsep.mjs`,
        };
        // 推理放到 worker，预生成时不会卡住页面
        wasmEnv.proxy = proxy;
      }
      return KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: onProgress as never,
      });
    };

    let tts: KokoroTTS;
    try {
      tts = await withTimeout(build(true), LOAD_TIMEOUT_MS, 'Worker 方式加载超时');
    } catch (err) {
      // 少数环境里 ORT worker 起不来（扩展拦截 / 老浏览器），退回主线程加载一次
      console.warn('[kokoro] Worker 方式加载失败，改为在主线程加载', err);
      files.clear();
      tts = await withTimeout(build(false), LOAD_TIMEOUT_MS, '模型加载超时');
    }

    instance = tts;
    kokoroState.phase = 'ready';
    kokoroState.progress = 100;
    kokoroState.text = 'Kokoro 语音已就绪';
    toast('Kokoro 语音已就绪');
    console.info(
      `[kokoro] 语音引擎就绪，耗时 ${Math.round(performance.now() - startedAt)}ms`
    );
    return tts;
  })();

  loading.catch((err: Error) => {
    instance = null;
    loading = null;
    kokoroState.phase = 'error';
    kokoroState.progress = 0;
    kokoroState.text = `Kokoro 加载失败：${err.message || '未知错误'}`;
    toast(`Kokoro 加载失败：${err.message || '未知错误'}，已回退系统语音`, 4000);
  });

  return loading;
}

/** 用 Kokoro 朗读；会等待模型下载完成 */
export async function speakKokoro(
  text: string,
  voice = DEFAULT_VOICE,
  speed = DEFAULT_SPEED
): Promise<void> {
  if (!text) return;
  // 先在用户手势内解锁 AudioContext，避免模型加载完才播放被浏览器拦截
  const ctx = getAudioContext();
  const seq = ++playSeq;
  const wav = await getOrCreateWav(text, voice, speed);
  // 加载期间用户可能又点了别的单词，只播放最后一次请求
  if (seq !== playSeq) return;
  // decodeAudioData 会接管传入的 ArrayBuffer，复制一份避免破坏缓存
  const buffer = await ctx.decodeAudioData(wav.slice(0));
  if (seq !== playSeq) return;
  stopPlayback();
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    source = null;
  };
  source.start();
}

/** 回收音频资源（页面卸载时调用） */
export function disposeKokoroAudio(): void {
  stopPlayback();
  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}
