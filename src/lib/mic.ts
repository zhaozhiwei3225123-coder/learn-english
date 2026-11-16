/**
 * 语音输入（Web Speech API）。
 *
 * 只负责「把麦克风里的话变成文本」，识别引擎是浏览器自带的：
 * - Chrome / Edge：走云端识别。Chrome 用的是 Google 的服务，国内基本连不上；
 *   Edge 走 Azure，国内可用。
 * - Safari：走系统听写，Mac / iOS 上一般能用，但连续识别不如 Chrome 稳。
 * 所以这里不假定一定能用：拿不到就返回 null，调用方退回打字。
 */

interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechResult {
  0: SpeechResultAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function micSupported(): boolean {
  return !!getCtor();
}

/** 把浏览器给的错误码翻译成能看懂的话 */
function explain(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风';
    case 'network':
      return '浏览器语音识别连不上服务器。Chrome 用的是 Google 服务，国内通常不通——换 Edge 或 Safari，或者直接打字';
    case 'no-speech':
      return '没听到声音，靠近麦克风再说一次';
    case 'audio-capture':
      return '找不到麦克风设备，检查一下系统设置';
    case 'aborted':
      return '';
    default:
      return `语音识别失败（${code}），先用打字吧`;
  }
}

export interface MicOptions {
  lang?: string;
  /** 识别到内容时回调；final=false 表示还是临时结果 */
  onResult: (text: string, final: boolean) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}

export interface MicHandle {
  stop: () => void;
}

/** 开始收音；浏览器不支持时返回 null */
export function startMic(opts: MicOptions): MicHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  let rec: SpeechRecognitionLike;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }

  let stopped = false;
  rec.lang = opts.lang || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      text += r[0]?.transcript ?? '';
      if (r.isFinal) final = true;
    }
    const clean = text.trim();
    if (clean) opts.onResult(clean, final);
  };

  rec.onerror = (e) => {
    const msg = explain(String(e?.error || 'unknown'));
    if (msg) opts.onError(msg);
  };

  rec.onend = () => {
    if (!stopped) opts.onEnd?.();
  };

  try {
    rec.start();
  } catch {
    // 上一次还没结束就再次 start 会抛 InvalidStateError
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* 忽略 */
      }
    },
  };
}
