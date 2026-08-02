import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';

import { colors, mono, sans } from '../../src/theme';
import { api, STTResponse } from '../../src/api';
import { formatClock } from '../../src/utils';

type State = 'idle' | 'recording' | 'transcribing' | 'ready';

const h = {
  light: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  heavy: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  select: () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  },
  success: () => {
    if (Platform.OS !== 'web')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  error: () => {
    if (Platform.OS !== 'web')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};

export default function DictationScreen() {
  const [state, setState] = useState<State>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 80);
  const isRec = !!recState.isRecording;
  const elapsedMs = recState.durationMillis ?? 0;

  // pulse animation
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isRec) {
      pulse.value = withRepeat(
        withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [isRec, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // On unmount safely stop ongoing recording
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        recorder.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRecord = useCallback(async () => {
    setError(null);

    // Stop flow
    if (isRec) {
      try {
        h.medium();
        setState('transcribing');
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('No audio captured.');
        await runTranscribe(uri, `capture-${Date.now()}.m4a`);
      } catch (e: any) {
        h.error();
        setError(e?.message || 'Recording stop failed');
        setState('idle');
      }
      return;
    }

    // Start flow
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission denied.');
        h.error();
        return;
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      setTranscript('');
      setTranscriptId(null);
      setCopied(false);

      await recorder.prepareToRecordAsync();
      recorder.record();
      h.success();
      setState('recording');
    } catch (e: any) {
      h.error();
      setError(e?.message || 'Could not start recording');
      setState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRec, recorder]);

  const runTranscribe = useCallback(
    async (uri: string, filename: string, webFile?: Blob | File | null) => {
      try {
        setState('transcribing');
        const mime = filename.endsWith('.m4a')
          ? 'audio/m4a'
          : filename.endsWith('.mp3')
          ? 'audio/mpeg'
          : filename.endsWith('.wav')
          ? 'audio/wav'
          : filename.endsWith('.webm')
          ? 'audio/webm'
          : 'audio/mpeg';
        const r: STTResponse = await api.transcribe(uri, filename, mime, webFile);
        setTranscript(r.transcript || '');
        setTranscriptId(r.id);
        setState('ready');
        h.success();
      } catch (e: any) {
        h.error();
        setError(e?.message || 'Transcription failed');
        setState('idle');
      }
    },
    []
  );

  const onImport = useCallback(async () => {
    h.light();
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ['audio/*'],
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setTranscript('');
      setTranscriptId(null);
      await runTranscribe(a.uri, a.name || 'import.mp3', a.file ?? null);
    } catch (e: any) {
      setError(e?.message || 'Import failed');
      setState('idle');
    }
  }, [runTranscribe]);

  const onClear = useCallback(async () => {
    h.select();
    if (isRec) {
      try {
        await recorder.stop();
      } catch {}
    }
    setTranscript('');
    setTranscriptId(null);
    setError(null);
    setState('idle');
    setCopied(false);
  }, [isRec, recorder]);

  const onCopy = useCallback(async () => {
    if (!transcript) return;
    try {
      await Clipboard.setStringAsync(toMarkdown(transcript));
      setCopied(true);
      h.success();
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }, [transcript]);

  const onExport = useCallback(async () => {
    if (!transcript) return;
    h.medium();
    const md = toMarkdown(transcript);
    const fname = `echo-transcript-${Date.now()}.md`;
    if (Platform.OS === 'web') {
      try {
        // eslint-disable-next-line no-undef
        const blob = new Blob([md], { type: 'text/markdown' });
        // eslint-disable-next-line no-undef
        const url = URL.createObjectURL(blob);
        // eslint-disable-next-line no-undef
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        // eslint-disable-next-line no-undef
        document.body.appendChild(a);
        a.click();
        // eslint-disable-next-line no-undef
        document.body.removeChild(a);
        // eslint-disable-next-line no-undef
        URL.revokeObjectURL(url);
      } catch (e: any) {
        setError('Export failed.');
      }
      return;
    }
    try {
      const path = `${FileSystem.cacheDirectory}${fname}`;
      await FileSystem.writeAsStringAsync(path, md, { encoding: FileSystem.EncodingType.UTF8 });
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(path, {
          mimeType: 'text/markdown',
          UTI: 'net.daringfireball.markdown',
          dialogTitle: 'Export transcript',
        });
      } else {
        await Share.share({ message: md, title: fname });
      }
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    }
  }, [transcript]);

  const timerText = formatClock(elapsedMs);
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  const statusLine = useMemo(() => {
    if (state === 'idle' && !transcript) return '> microphone standby';
    if (state === 'recording') return '> recording…';
    if (state === 'transcribing') return '> transcribing capture…';
    if (state === 'ready') return '> transcript ready · export as markdown when you are';
    return '> microphone standby';
  }, [state, transcript]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.logo}>ECHO</Text>
          <Text style={styles.caretTxt}>▸</Text>
          <Text style={styles.sectionTitle}>Dictation</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.pill}>
            <View style={[styles.pillDot, isRec && { backgroundColor: colors.red }]} />
            <Text style={styles.pillTxt}>{isRec ? 'LIVE' : 'IDLE'}</Text>
          </View>
        </View>
        <Text style={styles.tagline}>Record or import audio. Get a transcript back.</Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Transport Area */}
        <View style={styles.stage} testID="dictation-stage">
          <View style={styles.recordOrb}>
            <Animated.View style={[styles.pulseRing, pulseStyle]} />
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onRecord}
              disabled={state === 'transcribing'}
              style={[
                styles.recordBtn,
                isRec && styles.recordBtnActive,
                state === 'transcribing' && { opacity: 0.6 },
              ]}
              testID="record-button"
              accessibilityRole="button"
              accessibilityLabel={
                state === 'transcribing' ? 'Transcribing' : isRec ? 'Stop recording' : 'Start recording'
              }
              accessibilityState={{ disabled: state === 'transcribing', busy: state === 'transcribing' }}
            >
              {state === 'transcribing' ? (
                <ActivityIndicator color={colors.amber} size="large" />
              ) : isRec ? (
                <View style={styles.stopSquare} />
              ) : (
                <Ionicons name="mic" size={34} color={colors.amber} />
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.clock} testID="record-timer">{timerText}</Text>
          <Text style={styles.stateLabel}>
            {state === 'idle' && 'Tap to record'}
            {state === 'recording' && 'Tap to stop and transcribe'}
            {state === 'transcribing' && 'Transcribing…'}
            {state === 'ready' && 'Transcript ready'}
          </Text>

          <View style={styles.secondaryRow}>
            <TouchableOpacity
              onPress={onImport}
              disabled={isRec || state === 'transcribing'}
              style={styles.ghostBtn}
              testID="import-audio-button"
              accessibilityRole="button"
              accessibilityLabel="Import audio clip to transcribe"
              accessibilityState={{ disabled: isRec || state === 'transcribing' }}
            >
              <Ionicons name="attach-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.ghostBtnTxt}>IMPORT CLIP</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClear}
              disabled={state === 'transcribing'}
              style={styles.ghostBtn}
              testID="clear-transcript-button"
              accessibilityRole="button"
              accessibilityLabel="Reset transcript"
              accessibilityState={{ disabled: state === 'transcribing' }}
            >
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
              <Text style={styles.ghostBtnTxt}>RESET</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Console / Transcript */}
        <View style={styles.console} testID="transcript-console">
          <View style={styles.consoleHeader}>
            <View style={styles.consoleDots}>
              <View style={[styles.consoleDot, { backgroundColor: colors.red }]} />
              <View style={[styles.consoleDot, { backgroundColor: colors.amber }]} />
              <View style={[styles.consoleDot, { backgroundColor: colors.emerald }]} />
            </View>
            <Text style={styles.consoleTitle}>
              TRANSCRIPT CONSOLE · {formatClock(elapsedMs)}
            </Text>
          </View>

          <View style={styles.consoleBody}>
            {transcript ? (
              <Text selectable style={styles.transcriptText} testID="transcript-text">
                {transcript}
              </Text>
            ) : (
              <>
                <Text style={styles.consoleLine}>{statusLine}</Text>
                <Text style={styles.consoleLine}>
                  {'> press '}
                  <Text style={{ color: colors.amber }}>Record</Text>
                  {' to capture a voice note'}
                </Text>
                <Text style={styles.consoleLine}>
                  {'> export the resulting transcript as '}
                  <Text style={{ color: colors.amber }}>markdown</Text>
                  {' when ready'}
                </Text>
              </>
            )}
          </View>

          {transcript ? (
            <View style={styles.transcriptMeta}>
              <Text style={styles.metaTxt}>
                {wordCount} words · {transcript.length} chars
                {transcriptId ? ` · #${transcriptId.slice(0, 6)}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {transcript ? (
          <View style={styles.exportRow}>
            <TouchableOpacity
              onPress={onCopy}
              style={[styles.primaryBtn, styles.flex1, { marginRight: 8 }]}
              testID="copy-transcript-button"
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied to clipboard' : 'Copy transcript to clipboard'}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={14}
                color={colors.textPrimary}
              />
              <Text style={styles.primaryBtnTxt}>{copied ? 'COPIED' : 'COPY'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onExport}
              style={[styles.primaryBtn, styles.flex1, { backgroundColor: colors.amber, borderColor: colors.amber }]}
              testID="export-markdown-button"
              accessibilityRole="button"
              accessibilityLabel="Export transcript as markdown"
            >
              <Ionicons name="download-outline" size={14} color={colors.bg} />
              <Text style={[styles.primaryBtnTxt, { color: colors.bg, fontWeight: '700' }]}>
                EXPORT .MD
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.privacyNote} testID="privacy-note">
          Audio is sent only for transcription. Transcript stays on your device.
        </Text>

        {error ? (
          <View style={styles.errorBox} testID="dictation-error-box">
            <Text style={styles.errorTxt}>! {error}</Text>
          </View>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function toMarkdown(text: string) {
  const ts = new Date().toISOString();
  return `# ECHO Transcript\n\n> Captured ${ts}\n\n${text}\n`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  flex1: { flex: 1 },

  header: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: {
    fontFamily: mono, fontSize: 20, color: colors.amber, letterSpacing: 3,
    fontWeight: '600',
  },
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
  pillDot: { width: 5, height: 5, backgroundColor: colors.textMuted },
  pillTxt: { fontFamily: mono, fontSize: 9.5, letterSpacing: 2, color: colors.textMuted },

  stage: {
    alignItems: 'center', marginTop: 22,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingVertical: 26, paddingHorizontal: 16, backgroundColor: colors.surface,
  },
  recordOrb: {
    width: 160, height: 160, alignItems: 'center', justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.redDim,
  },
  recordBtn: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1, borderColor: colors.amber,
    backgroundColor: colors.panel,
    alignItems: 'center', justifyContent: 'center',
  },
  recordBtnActive: { borderColor: colors.red, backgroundColor: 'rgba(239,68,68,0.08)' },
  stopSquare: { width: 28, height: 28, backgroundColor: colors.red },

  clock: {
    fontFamily: mono, fontSize: 30, letterSpacing: 2, color: colors.textPrimary,
    marginTop: 18,
  },
  stateLabel: {
    fontFamily: mono, fontSize: 11, letterSpacing: 2, color: colors.textMuted,
    marginTop: 8, textTransform: 'uppercase',
  },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  ghostBtnTxt: {
    fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, color: colors.textSecondary,
  },

  console: {
    marginTop: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  consoleHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  consoleDots: { flexDirection: 'row', gap: 6 },
  consoleDot: { width: 8, height: 8, borderRadius: 4 },
  consoleTitle: { fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textMuted },
  consoleBody: { paddingHorizontal: 14, paddingVertical: 16, minHeight: 140 },
  consoleLine: { fontFamily: mono, fontSize: 13, lineHeight: 22, color: colors.amber },
  transcriptText: { fontFamily: mono, fontSize: 14, lineHeight: 24, color: colors.textPrimary },
  transcriptMeta: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  metaTxt: { fontFamily: mono, fontSize: 10, color: colors.textMuted, letterSpacing: 1.4 },

  exportRow: { flexDirection: 'row', marginTop: 12 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  primaryBtnTxt: {
    fontFamily: mono, fontSize: 11.5, letterSpacing: 2, color: colors.textPrimary,
  },

  privacyNote: {
    fontFamily: mono, fontSize: 10.5, color: colors.textMuted, letterSpacing: 1.4,
    marginTop: 14, textAlign: 'center',
  },
  errorBox: {
    marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.red,
    backgroundColor: colors.redDim, padding: 10,
  },
  errorTxt: { fontFamily: mono, fontSize: 12, color: colors.red },
});
