import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';

import { colors, mono, type, sans } from '../../src/theme';
import { api, Voice, WordTiming } from '../../src/api';
import { wordAndCharCount, truncateMiddle } from '../../src/utils';
import { pendingDraft } from '../../src/store';

const h = {
  light: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  select: () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  },
  success: () => {
    if (Platform.OS !== 'web')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
};

export default function ReadbackScreen() {
  const isWeb = Platform.OS === 'web';
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>('echo');
  const [speed, setSpeed] = useState<number>(1.0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [playbackHint, setPlaybackHint] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);

  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [words, setWords] = useState<WordTiming[]>([]);
  const [estimatedDuration, setEstimatedDuration] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [webIsPlaying, setWebIsPlaying] = useState(false);
  const [webPositionMs, setWebPositionMs] = useState(0);
  const [webDurationMs, setWebDurationMs] = useState(0);

  const player: AudioPlayer = useAudioPlayer(
    !isWeb && audioUri ? { uri: audioUri } : null,
    { updateInterval: 80 }
  );
  const status: AudioStatus = useAudioPlayerStatus(player);
  const isPlaying = isWeb ? webIsPlaying : !!status?.playing;
  const positionMs = isWeb
    ? webPositionMs
    : Math.max(0, Math.round((status?.currentTime ?? 0) * 1000));
  const durationMs = isWeb
    ? webDurationMs
    : Math.max(0, Math.round((status?.duration ?? 0) * 1000));
  const displayWords = useMemo(
    () => scaleWordTimings(words, estimatedDuration, durationMs),
    [words, estimatedDuration, durationMs]
  );

  const wordsRef = useRef<WordTiming[]>([]);
  wordsRef.current = displayWords;
  const lastActiveRef = useRef<number>(-1);
  const audioObjectUrlRef = useRef<string | null>(null);
  const shouldAutoplayRef = useRef(false);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);
  const webLoadedUriRef = useRef<string | null>(null);
  const webReplayGuardUntilRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const { words: wc, chars: cc, mins } = wordAndCharCount(text);

  const revokeObjectUrl = useCallback(() => {
    if (Platform.OS === 'web' && audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }, []);

  const pauseCurrentAudio = useCallback(() => {
    if (isWeb) {
      webAudioRef.current?.pause();
      return;
    }
    player.pause();
  }, [isWeb, player]);

  const seekToStart = useCallback(() => {
    if (isWeb) {
      if (webAudioRef.current) {
        webAudioRef.current.currentTime = 0;
      }
      setWebPositionMs(0);
      return;
    }
    player.seekTo(0);
  }, [isWeb, player]);

  const resetAudio = useCallback(() => {
    shouldAutoplayRef.current = false;
    try {
      pauseCurrentAudio();
    } catch {}
    if (isWeb && webAudioRef.current) {
      webAudioRef.current.removeAttribute('src');
      webAudioRef.current.load();
      webLoadedUriRef.current = null;
      setWebIsPlaying(false);
      setWebPositionMs(0);
      setWebDurationMs(0);
    }
    revokeObjectUrl();
    setAudioUri(null);
    setWords([]);
    setEstimatedDuration(0);
    setPlaybackHint(null);
    setActiveIdx(-1);
    lastActiveRef.current = -1;
  }, [isWeb, pauseCurrentAudio, revokeObjectUrl]);

  // ------------------------ Voices + audio mode
  useEffect(() => {
    (async () => {
      try {
        const { voices, default: def } = await api.getVoices();
        setVoices(voices);
        if (def) setVoiceId(def);
      } catch (e) {
        console.warn('voices fetch failed', e);
      }
      try {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!isWeb) return;

    const audio = new Audio();
    audio.preload = 'auto';
    webAudioRef.current = audio;

    const stopRaf = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const syncPosition = () => {
      setWebPositionMs(Math.max(0, Math.round((audio.currentTime || 0) * 1000)));
      setWebDurationMs(Number.isFinite(audio.duration) ? Math.max(0, Math.round(audio.duration * 1000)) : 0);
      if (!audio.paused && !audio.ended) {
        rafRef.current = requestAnimationFrame(syncPosition);
      } else {
        rafRef.current = null;
      }
    };

    const handlePlay = () => {
      setWebIsPlaying(true);
      syncPosition();
    };
    const handlePause = () => {
      stopRaf();
      setWebIsPlaying(false);
      setWebPositionMs(Math.max(0, Math.round((audio.currentTime || 0) * 1000)));
    };
    const handleLoadedMetadata = () => {
      setWebDurationMs(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    const handleEnded = () => {
      stopRaf();
      setWebIsPlaying(false);
      setWebPositionMs(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
      setActiveIdx(-1);
      lastActiveRef.current = -1;
      h.light();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      stopRaf();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      webAudioRef.current = null;
    };
  }, [isWeb]);

  useEffect(() => {
    return () => {
      revokeObjectUrl();
    };
  }, [revokeObjectUrl]);

  useEffect(() => {
    if (!isWeb || !webAudioRef.current) return;

    const audio = webAudioRef.current;
    if (!audioUri) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      webLoadedUriRef.current = null;
      setWebIsPlaying(false);
      setWebPositionMs(0);
      setWebDurationMs(0);
      return;
    }

    setWebPositionMs(0);
    setWebDurationMs(0);
  }, [audioUri, isWeb]);

  // Load pending draft from Library on focus
  useFocusEffect(
    useCallback(() => {
      const pending = pendingDraft.consume();
      if (pending?.text != null) {
        setText(pending.text);
        setFilename(pending.title || null);
        setError(null);
        resetAudio();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // ------------------------ Playback-driven word tracking + haptic
  useEffect(() => {
    const ws = wordsRef.current;
    if (!ws.length || !audioUri) return;
    const t = positionMs / 1000;
    let idx = -1;
    for (let i = 0; i < ws.length; i++) {
      if (t >= ws[i].start && t <= ws[i].end) {
        idx = i;
        break;
      }
      if (t < ws[i].start) {
        idx = Math.max(0, i - 1);
        break;
      }
    }
    if (idx === -1 && t >= ws[ws.length - 1].end) idx = ws.length - 1;
    if (idx !== lastActiveRef.current) {
      lastActiveRef.current = idx;
      setActiveIdx(idx);
      if (isPlaying && idx >= 0) {
        const w = ws[idx].word;
        if (w && /[.!?,;:]$/.test(w)) h.select();
      }
    }
  }, [positionMs, audioUri, isPlaying]);

  useEffect(() => {
    if (isWeb) return;
    if (status?.didJustFinish) {
      setActiveIdx(-1);
      lastActiveRef.current = -1;
      h.light();
    }
  }, [isWeb, status?.didJustFinish]);

  // ------------------------ Helpers
  const makePlayableAudioUri = useCallback(
    (audioBase64: string, mime: string) => {
      revokeObjectUrl();
      return `data:${mime};base64,${audioBase64}`;
    },
    [revokeObjectUrl]
  );

  const prepareWebAudio = useCallback(async () => {
    if (!audioUri || !webAudioRef.current) {
      throw new Error('Audio is not ready yet.');
    }
    if (webLoadedUriRef.current === audioUri) {
      return;
    }

    const audio = webAudioRef.current;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        webLoadedUriRef.current = audioUri;
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Audio could not be prepared in this browser.'));
      };
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
      };

      audio.pause();
      audio.currentTime = 0;
      audio.autoplay = false;
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('error', onError);
      audio.src = audioUri;
      audio.load();
    });
  }, [audioUri]);

  const playCurrentAudio = useCallback(
    async (blockedMessage: string) => {
      try {
        if (isWeb) {
          if (!webAudioRef.current) {
            throw new Error('Browser audio engine is unavailable.');
          }
          await prepareWebAudio();
          await webAudioRef.current.play();
        } else {
          await Promise.resolve(player.play());
        }
        setPlaybackHint(null);
        h.medium();
        return true;
      } catch (e) {
        setError(formatPlaybackError(e, blockedMessage));
        return false;
      }
    },
    [isWeb, player, prepareWebAudio]
  );

  useEffect(() => {
    if (isWeb || !audioUri || !shouldAutoplayRef.current) return;
    shouldAutoplayRef.current = false;

    const timer = setTimeout(() => {
      void playCurrentAudio('Audio is ready. Press PLAY again to start playback in this browser.');
    }, 120);

    return () => clearTimeout(timer);
  }, [audioUri, isWeb, playCurrentAudio]);

  // ------------------------ Actions
  const onLoadSample = useCallback(async () => {
    h.select();
    try {
      const r = await api.getSampleText();
      setText(r.text);
      setFilename(null);
      setError(null);
      resetAudio();
    } catch (e: any) {
      setError(e?.message || 'Failed to load sample');
    }
  }, [resetAudio]);

  const onClear = useCallback(() => {
    h.select();
    setText('');
    setFilename(null);
    setError(null);
    setPlaybackHint(null);
    setSaveHint(null);
    resetAudio();
  }, [resetAudio]);

  const onImport = useCallback(async () => {
    h.light();
    try {
      setError(null);
      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: [
          'text/plain',
          'text/markdown',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          '*/*',
        ],
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const name = (a.name || '').toLowerCase();
      const ok = ['.txt', '.md', '.pdf', '.docx'].some((ext) => name.endsWith(ext));
      if (!ok) {
        setError('Unsupported file. Use .txt, .md, .docx, or .pdf.');
        return;
      }
      setLoading(true);
      setFilename(a.name || null);
      const parsed = await api.parseFile(
        a.uri,
        a.name || 'file',
        a.mimeType || 'application/octet-stream',
        a.file ?? null
      );
      setText(parsed.text || '');
      resetAudio();
      h.success();
    } catch (e: any) {
      setError(e?.message || 'File import failed');
    } finally {
      setLoading(false);
    }
  }, [resetAudio]);

  const onPlay = useCallback(async () => {
    setError(null);
    const t = (text || '').trim();
    if (!t) {
      setError('Paste text or import a file first.');
      return;
    }
    if (audioUri) {
      try {
        if (isWeb && Date.now() < webReplayGuardUntilRef.current) {
          setPlaybackHint('Audio ready. Press PLAY to start readback.');
          return;
        }
        if (isPlaying) {
          pauseCurrentAudio();
          setPlaybackHint(null);
          h.light();
        } else {
          if (durationMs > 0 && positionMs >= durationMs - 120) {
            seekToStart();
          }
          await playCurrentAudio('Playback failed. Press PLAY again, or reload if the browser keeps blocking audio.');
        }
      } catch (e) {
        setError(formatPlaybackError(e, 'Playback failed.'));
      }
      return;
    }
    try {
      if (!isWeb) {
        setGenerating(true);
      }
      h.light();
      const r = await api.generateTTS(t, voiceId, speed);
      setWords(r.words);
      setEstimatedDuration(r.estimated_duration);
      setActiveIdx(-1);
      lastActiveRef.current = -1;
      const uri = makePlayableAudioUri(r.audio_base64, r.mime);
      setAudioUri(uri);
      if (isWeb) {
        webReplayGuardUntilRef.current = Date.now() + 400;
        setPlaybackHint('Audio ready. Press PLAY to start readback.');
      } else {
        shouldAutoplayRef.current = true;
      }
    } catch (e: any) {
      setError(e?.message || 'Readback failed');
    } finally {
      if (!isWeb) {
        setGenerating(false);
      }
    }
  }, [
    isWeb,
    text,
    audioUri,
    isPlaying,
    durationMs,
    positionMs,
    voiceId,
    speed,
    makePlayableAudioUri,
    pauseCurrentAudio,
    playCurrentAudio,
    seekToStart,
  ]);

  const onStop = useCallback(() => {
    h.medium();
    shouldAutoplayRef.current = false;
    try {
      pauseCurrentAudio();
      seekToStart();
    } catch {}
    revokeObjectUrl();
    setAudioUri(null);
    setWords([]);
    setEstimatedDuration(0);
    setPlaybackHint(null);
    setActiveIdx(-1);
    lastActiveRef.current = -1;
    if (isWeb) {
      setWebIsPlaying(false);
      setWebPositionMs(0);
      setWebDurationMs(0);
    }
  }, [isWeb, pauseCurrentAudio, revokeObjectUrl, seekToStart]);

  const onSaveDraft = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      setError('Nothing to save — paste or import text first.');
      return;
    }
    try {
      const title =
        filename?.replace(/\.(txt|md|pdf|docx)$/i, '') ||
        t.split(/\s+/).slice(0, 6).join(' ').slice(0, 60) ||
        'Untitled draft';
      await api.saveDraft(title, t);
      setSaveHint('Saved to Library');
      h.success();
      setTimeout(() => setSaveHint(null), 2000);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
  }, [text, filename]);

  useEffect(() => {
    if (audioUri) {
      resetAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceId, speed]);

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const selectedVoice = voices.find((v) => v.id === voiceId);

  const readbackContent = useMemo(() => {
    if (!displayWords.length) {
      return (
        <Text style={styles.readbackPlaceholder}>
          {text ? 'Press PLAY to begin natural readback with live word tracking.' : '> awaiting draft input'}
        </Text>
      );
    }
    return (
      <Text style={styles.readbackBody}>
        {displayWords.map((w, i) => (
          <Text
            key={`${w.index}-${i}`}
            style={[
              styles.word,
              i === activeIdx && styles.wordActive,
              i < activeIdx && styles.wordPast,
            ]}
          >
            {w.word + ' '}
          </Text>
        ))}
      </Text>
    );
  }, [activeIdx, displayWords, text]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.flex}>
            <View style={styles.header} testID="readback-header">
              <View style={styles.headerRow}>
                <Text style={styles.logo}>ECHO</Text>
                <View style={styles.caret}>
                  <Text style={styles.caretTxt}>▸</Text>
                </View>
                <Text style={styles.sectionTitle}>Readback</Text>
                <View style={{ flex: 1 }} />
                <View style={styles.pill}>
                  <View style={styles.pillDot} />
                  <Text style={styles.pillTxt}>ON DEVICE</Text>
                </View>
              </View>
              <Text style={styles.tagline}>Hear your draft, on this device.</Text>
            </View>

            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.panel} testID="draft-intake-panel">
                <View style={styles.panelHeader}>
                  <Text style={styles.caption}>Draft Intake</Text>
                  <View style={styles.toolbar}>
                    <TouchableOpacity
                      onPress={onLoadSample}
                      style={styles.toolBtn}
                      testID="load-sample-button"
                    >
                      <Ionicons name="sparkles-outline" size={12} color={colors.textSecondary} />
                      <Text style={styles.toolBtnTxt}>SAMPLE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={onSaveDraft}
                      style={styles.toolBtn}
                      testID="save-draft-button"
                    >
                      <Ionicons name="bookmark-outline" size={12} color={colors.amber} />
                      <Text style={[styles.toolBtnTxt, { color: colors.amber }]}>SAVE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={onClear}
                      style={styles.toolBtn}
                      testID="clear-button"
                    >
                      <Ionicons name="close" size={14} color={colors.textSecondary} />
                      <Text style={styles.toolBtnTxt}>CLEAR</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={onImport}
                  activeOpacity={0.85}
                  style={styles.dropzone}
                  testID="import-file-button"
                >
                  {loading ? (
                    <ActivityIndicator color={colors.amber} />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={22} color={colors.textMuted} />
                      <Text style={styles.dropzoneTitle}>
                        {filename ? truncateMiddle(filename, 36) : 'Choose a file'}
                      </Text>
                      <Text style={styles.dropzoneSub}>
                        .txt · .md · .docx · .pdf
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.textFieldWrap}>
                  <Text style={styles.miniLabel}>Text Body</Text>
                  <TextInput
                    value={text}
                    onChangeText={(value) => {
                      setText(value);
                      if (audioUri) resetAudio();
                    }}
                    multiline
                    placeholder="Paste notes, drafts, or finished docs…"
                    placeholderTextColor={colors.textFaint}
                    style={styles.textInput}
                    textAlignVertical="top"
                    testID="text-intake-input"
                  />
                </View>

                <View style={styles.statsRow}>
                  <StatCell label="Words" value={String(wc)} />
                  <StatCell label="Chars" value={String(cc)} />
                  <StatCell label="Est" value={`${mins} min`} />
                </View>

                <Text style={styles.cleanupHint}>
                  Readback automatically strips markdown markers like headings and list dashes.
                </Text>

                {saveHint ? (
                  <View style={styles.saveToast} testID="save-toast">
                    <Ionicons name="checkmark-circle" size={12} color={colors.emerald} />
                    <Text style={styles.saveToastTxt}>{saveHint}</Text>
                  </View>
                ) : null}

                {playbackHint ? (
                  <View style={styles.playbackHint} testID="playback-hint">
                    <Ionicons name="play-circle-outline" size={12} color={colors.amber} />
                    <Text style={styles.playbackHintTxt}>{playbackHint}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.panelLite}>
                <View style={styles.panelHeader}>
                  <Text style={styles.caption}>Voice Profile</Text>
                  {selectedVoice ? (
                    <Text style={styles.selectedVoiceTag}>{selectedVoice.tag}</Text>
                  ) : null}
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.voiceRow}
                >
                  {voices.map((voice) => {
                    const active = voice.id === voiceId;
                    return (
                      <TouchableOpacity
                        key={voice.id}
                        onPress={() => {
                          h.select();
                          setVoiceId(voice.id);
                        }}
                        style={[styles.voiceChip, active && styles.voiceChipActive]}
                        testID={`voice-chip-${voice.id}`}
                      >
                        <Text style={[styles.voiceChipTxt, active && styles.voiceChipTxtActive]}>
                          {voice.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.transport} testID="transport-panel">
                <View style={styles.transportTop}>
                  <Text style={styles.caption}>Transport</Text>
                  <View style={styles.speedRow}>
                    {[0.75, 1.0, 1.25, 1.5].map((value) => (
                      <TouchableOpacity
                        key={value}
                        onPress={() => {
                          h.select();
                          setSpeed(value);
                        }}
                        style={[styles.speedChip, speed === value && styles.speedChipActive]}
                        testID={`speed-${value}`}
                      >
                        <Text style={[styles.speedTxt, speed === value && styles.speedTxtActive]}>
                          {value}x
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeTxt}>{fmt(positionMs)}</Text>
                  <Text style={[styles.timeTxt, { color: colors.textMuted }]}>
                    {fmt(durationMs)}
                  </Text>
                </View>

                <View style={styles.controlsRow}>
                  <TouchableOpacity
                    onPress={onStop}
                    style={styles.iconBtn}
                    testID="stop-button"
                  >
                    <Ionicons name="stop" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onPlay}
                    disabled={generating}
                    style={[styles.playBtn, generating && { opacity: 0.7 }]}
                    testID="play-pause-button"
                  >
                    <Ionicons
                      name={generating ? 'sync-outline' : isPlaying ? 'pause' : 'play'}
                      size={22}
                      color={colors.bg}
                    />
                  </TouchableOpacity>
                  <View style={styles.iconBtn}>
                    <Text style={styles.voiceShort}>
                      {selectedVoice?.name?.toUpperCase()?.slice(0, 3) || '---'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.readbackPanel} testID="readback-pane">
                <View style={styles.panelHeader}>
                  <Text style={styles.caption}>Live Readback</Text>
                  <View style={styles.pillSmall}>
                    <View style={[styles.pillDot, isPlaying && { backgroundColor: colors.amber }]} />
                    <Text style={styles.pillTxt}>
                      {isPlaying ? 'TRACKING' : displayWords.length ? 'PAUSED' : 'IDLE'}
                    </Text>
                  </View>
                </View>
                {readbackContent}
              </View>

              {error ? (
                <View style={styles.errorBox} testID="error-box">
                  <Text style={styles.errorTxt}>! {error}</Text>
                </View>
              ) : null}

              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function fmt(ms: number) {
  if (!isFinite(ms) || ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatPlaybackError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/NotAllowedError|user gesture|autoplay/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

function scaleWordTimings(words: WordTiming[], estimatedDuration: number, actualDurationMs: number) {
  if (!words.length) return words;
  const actualDuration = actualDurationMs > 0 ? actualDurationMs / 1000 : 0;
  if (!estimatedDuration || !actualDuration) return words;

  const scale = actualDuration / estimatedDuration;
  if (!isFinite(scale) || Math.abs(scale - 1) < 0.04) return words;

  return words.map((word) => ({
    ...word,
    start: Number((word.start * scale).toFixed(3)),
    end: Number((word.end * scale).toFixed(3)),
  }));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: {
    fontFamily: mono, fontSize: 20, color: colors.amber, letterSpacing: 3,
    fontWeight: '600',
  },
  caret: { paddingHorizontal: 2 },
  caretTxt: { fontFamily: mono, color: colors.textMuted, fontSize: 12 },
  sectionTitle: {
    fontFamily: mono, fontSize: 13, color: colors.textSecondary,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  tagline: { fontFamily: sans, fontSize: 15, color: colors.textSecondary, marginTop: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  pillDot: { width: 5, height: 5, backgroundColor: colors.textMuted },
  pillTxt: { fontFamily: mono, fontSize: 9.5, letterSpacing: 2, color: colors.textMuted },

  panel: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginTop: 16,
  },
  panelLite: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginTop: 12,
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  caption: { ...type.caption },
  toolbar: { flexDirection: 'row', gap: 6 },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  toolBtnTxt: {
    fontFamily: mono, fontSize: 10, letterSpacing: 1.8, color: colors.textSecondary,
  },

  dropzone: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderDashed,
    paddingVertical: 20, paddingHorizontal: 16, alignItems: 'center',
    backgroundColor: colors.panel, gap: 6,
  },
  dropzoneTitle: {
    fontFamily: sans, fontSize: 14, color: colors.textPrimary, marginTop: 2,
  },
  dropzoneSub: {
    fontFamily: mono, fontSize: 10, letterSpacing: 1.6, color: colors.textMuted,
  },

  textFieldWrap: { marginTop: 14 },
  miniLabel: {
    fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textMuted,
    marginBottom: 6,
  },
  textInput: {
    minHeight: 140,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 12, paddingVertical: 12,
    fontFamily: sans, fontSize: 15, lineHeight: 23, color: colors.textPrimary,
  },

  statsRow: {
    flexDirection: 'row', marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border, paddingTop: 10,
  },
  cleanupHint: {
    marginTop: 8,
    fontFamily: sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
  },
  statCell: { flex: 1 },
  statLabel: {
    fontFamily: mono, fontSize: 9.5, letterSpacing: 2, color: colors.textMuted,
  },
  statValue: {
    fontFamily: mono, fontSize: 14, color: colors.textPrimary, marginTop: 3,
  },

  saveToast: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: 'rgba(74,222,128,0.06)', borderLeftWidth: 2, borderLeftColor: colors.emerald,
  },
  saveToastTxt: { fontFamily: mono, fontSize: 11, letterSpacing: 1.4, color: colors.emerald },
  playbackHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: colors.amberFaint, borderLeftWidth: 2, borderLeftColor: colors.amber,
  },
  playbackHintTxt: {
    fontFamily: mono, fontSize: 11, letterSpacing: 1.2, color: colors.amber,
  },

  voiceRow: { gap: 8, paddingRight: 8 },
  voiceChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  voiceChipActive: {
    backgroundColor: colors.amber, borderColor: colors.amber,
  },
  voiceChipTxt: {
    fontFamily: mono, fontSize: 11.5, letterSpacing: 1.4, color: colors.textSecondary,
  },
  voiceChipTxtActive: { color: colors.bg, fontWeight: '700' },
  selectedVoiceTag: {
    fontFamily: mono, fontSize: 10, color: colors.textMuted, letterSpacing: 1.2,
  },

  transport: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: 14, marginTop: 12,
  },
  transportTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  speedRow: { flexDirection: 'row', gap: 6 },
  speedChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  speedChipActive: {
    backgroundColor: colors.surfaceElevated, borderColor: colors.amber,
  },
  speedTxt: {
    fontFamily: mono, fontSize: 10.5, color: colors.textMuted, letterSpacing: 1,
  },
  speedTxtActive: { color: colors.amber },
  progressTrack: {
    height: 3, backgroundColor: colors.border, width: '100%', overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: colors.amber },
  timeRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 14,
  },
  timeTxt: { fontFamily: mono, fontSize: 11, color: colors.textSecondary, letterSpacing: 1 },

  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  iconBtn: {
    width: 52, height: 52, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  playBtn: {
    width: 72, height: 72, backgroundColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  voiceShort: {
    fontFamily: mono, fontSize: 11, letterSpacing: 2, color: colors.textMuted,
  },

  readbackPanel: {
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: 16, marginTop: 12, minHeight: 180,
  },
  readbackBody: {
    fontFamily: sans, fontSize: 16, lineHeight: 27, color: colors.textSecondary,
  },
  word: { color: colors.textSecondary },
  wordActive: {
    color: colors.amber, backgroundColor: colors.amberDim, fontWeight: '700',
  },
  wordPast: { color: colors.textPrimary },
  readbackPlaceholder: {
    fontFamily: mono, fontSize: 13, color: colors.textMuted, letterSpacing: 0.5,
  },
  errorBox: {
    marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.red,
    backgroundColor: colors.redDim, padding: 10,
  },
  errorTxt: { fontFamily: mono, fontSize: 12, color: colors.red },
});
