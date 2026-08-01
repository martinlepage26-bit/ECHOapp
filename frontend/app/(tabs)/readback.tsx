import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
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

import { colors } from '../../src/theme';
import { api, Voice, WordTiming } from '../../src/api';
import { wordAndCharCount, truncateMiddle } from '../../src/utils';
import { pendingDraft } from '../../src/store';
import {
  fmtMs,
  formatPlaybackError,
  makePlayableAudioUri as buildPlayableAudioUri,
  scaleWordTimings,
} from '../../src/readbackAudio';
import { styles } from '../../src/readbackStyles';

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
        const preferredVoiceId =
          voices.find((voice) => voice.id === 'echo')?.id ||
          def ||
          voices[0]?.id ||
          'echo';
        setVoiceId(preferredVoiceId);
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
      const finalIdx = wordsRef.current.length ? wordsRef.current.length - 1 : -1;
      setActiveIdx(finalIdx);
      lastActiveRef.current = finalIdx;
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
    if (!isPlaying && positionMs <= 0 && lastActiveRef.current < 0) {
      return;
    }
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
      const finalIdx = wordsRef.current.length ? wordsRef.current.length - 1 : -1;
      setActiveIdx(finalIdx);
      lastActiveRef.current = finalIdx;
      h.light();
    }
  }, [isWeb, status?.didJustFinish]);

  // ------------------------ Helpers
  const makePlayableAudioUri = useCallback(
    (audioBase64: string, mime: string) =>
      buildPlayableAudioUri(audioBase64, mime, {
        isWeb,
        revokePrevious: revokeObjectUrl,
        trackObjectUrl: (url) => {
          audioObjectUrlRef.current = url;
        },
      }),
    [isWeb, revokeObjectUrl]
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
      // Guard both platforms: web previously skipped this and double-taps could burn two TTS calls.
      setGenerating(true);
      h.light();
      const r = await api.generateTTS(t, voiceId, speed);
      setWords(r.words);
      setEstimatedDuration(r.estimated_duration);
      setActiveIdx(-1);
      lastActiveRef.current = -1;
      const uri = makePlayableAudioUri(r.audio_base64, r.mime);
      setAudioUri(uri);
      if (isWeb) {
        setPlaybackHint('Audio ready. Press PLAY to start readback.');
      } else {
        shouldAutoplayRef.current = true;
      }
    } catch (e: any) {
      setError(e?.message || 'Readback failed');
    } finally {
      setGenerating(false);
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
            testID={i === activeIdx ? 'active-readback-word' : undefined}
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
                  <Text style={styles.timeTxt}>{fmtMs(positionMs)}</Text>
                  <Text style={[styles.timeTxt, { color: colors.textMuted }]}>
                    {fmtMs(durationMs)}
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
