/** 发音入口：优先 Kokoro 本地模型，失败时回退浏览器系统语音 */
import type { TtsEngine } from '../types';
import { speakKokoro } from './kokoro';
import { toast } from '../store/toast';

export interface SpeakOptions {
  engine?: TtsEngine;
  voice?: string;
}

let warnedKokoroFailure = false;

/** 浏览器朗读（Web Speech API），失败静默 */
export function speakSystem(text: string): void {
  if (!text || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* 忽略 */
  }
}

export async function speak(
  text: string,
  { engine = 'system', voice }: SpeakOptions = {}
): Promise<void> {
  if (!text) return;

  if (engine === 'kokoro') {
    try {
      await speakKokoro(text, voice);
      warnedKokoroFailure = false;
      return;
    } catch (err) {
      console.warn('[speech] Kokoro 发音失败，回退系统语音', err);
      if (!warnedKokoroFailure) {
        warnedKokoroFailure = true;
        toast('Kokoro 发音失败，已回退系统语音');
      }
    }
  }

  speakSystem(text);
}
