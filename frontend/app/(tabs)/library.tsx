import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { colors, mono, sans } from '../../src/theme';
import { api, DraftRow, TranscriptRow } from '../../src/api';
import { pendingDraft } from '../../src/store';

type Tab = 'drafts' | 'transcripts';

export default function LibraryScreen() {
  const [tab, setTab] = useState<Tab>('drafts');
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [d, t] = await Promise.all([api.listDrafts(), api.listTranscripts()]);
      setDrafts(d);
      setTranscripts(t);
    } catch (e: any) {
      setError(e?.message || 'Failed to load library');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancel = false;
      setLoading(true);
      loadAll().finally(() => {
        if (!cancel) setLoading(false);
      });
      return () => {
        cancel = true;
      };
    }, [loadAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const onOpenDraft = useCallback(
    (d: DraftRow) => {
      if (Platform.OS !== 'web') {
        Haptics.selectionAsync();
      }
      pendingDraft.set({ text: d.text, title: d.title });
      router.push('/(tabs)/readback');
    },
    [router]
  );

  const onDeleteDraft = useCallback(
    (d: DraftRow) => {
      const doDelete = async () => {
        try {
          await api.deleteDraft(d.id);
          setDrafts((prev) => prev.filter((x) => x.id !== d.id));
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch (e: any) {
          setError(e?.message || 'Delete failed');
        }
      };
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert, no-undef
        if (confirm(`Delete "${d.title}"?`)) void doDelete();
      } else {
        Alert.alert('Delete draft', `Remove "${d.title}"?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]);
      }
    },
    []
  );

  const onDeleteTranscript = useCallback((t: TranscriptRow) => {
    const doDelete = async () => {
      try {
        await api.deleteTranscript(t.id);
        setTranscripts((prev) => prev.filter((x) => x.id !== t.id));
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (e: any) {
        setError(e?.message || 'Delete failed');
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert, no-undef
      if (confirm('Delete transcript?')) void doDelete();
    } else {
      Alert.alert('Delete transcript', 'Remove this transcript?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, []);

  const onCopy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const onExportTranscript = useCallback(async (t: TranscriptRow) => {
    const md = `# ECHO Transcript\n\n> ${t.created_at}\n\n${t.text}\n`;
    const fname = `echo-transcript-${t.id.slice(0, 8)}.md`;
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
      } catch {}
      return;
    }
    try {
      const path = `${FileSystem.cacheDirectory}${fname}`;
      await FileSystem.writeAsStringAsync(path, md, { encoding: FileSystem.EncodingType.UTF8 });
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(path, { mimeType: 'text/markdown', dialogTitle: 'Export transcript' });
      } else {
        await Share.share({ message: md, title: fname });
      }
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const activeList: Array<DraftRow | TranscriptRow> =
    tab === 'drafts' ? drafts : transcripts;
  const count = activeList.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.logo}>ECHO</Text>
          <Text style={styles.caretTxt}>▸</Text>
          <Text style={styles.sectionTitle}>Library</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillTxt}>{count} SAVED</Text>
          </View>
        </View>
        <Text style={styles.tagline}>Drafts and transcripts, kept on your device.</Text>
      </View>

      {/* Segmented control */}
      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'drafts' && styles.segmentBtnActive]}
          onPress={() => {
            setTab('drafts');
            if (Platform.OS !== 'web') Haptics.selectionAsync();
          }}
          testID="library-tab-drafts"
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'drafts' }}
          accessibilityLabel={`Drafts, ${drafts.length}`}
        >
          <Ionicons
            name="document-text-outline"
            size={13}
            color={tab === 'drafts' ? colors.amber : colors.textMuted}
          />
          <Text
            style={[
              styles.segmentTxt,
              tab === 'drafts' && { color: colors.amber },
            ]}
          >
            DRAFTS · {drafts.length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'transcripts' && styles.segmentBtnActive]}
          onPress={() => {
            setTab('transcripts');
            if (Platform.OS !== 'web') Haptics.selectionAsync();
          }}
          testID="library-tab-transcripts"
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'transcripts' }}
          accessibilityLabel={`Transcripts, ${transcripts.length}`}
        >
          <Ionicons
            name="mic-outline"
            size={13}
            color={tab === 'transcripts' ? colors.amber : colors.textMuted}
          />
          <Text
            style={[
              styles.segmentTxt,
              tab === 'transcripts' && { color: colors.amber },
            ]}
          >
            TRANSCRIPTS · {transcripts.length}
          </Text>
        </TouchableOpacity>
      </View>

      {loading && count === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.amber} />
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.amber}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {tab === 'drafts' ? (
            drafts.length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                title="No drafts saved yet"
                hint="Compose text in Readback, then tap SAVE to keep it here."
              />
            ) : (
              drafts.map((d, i) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  index={i}
                  expanded={!!expanded[d.id]}
                  onToggle={() => toggleExpand(d.id)}
                  onOpen={() => onOpenDraft(d)}
                  onCopy={() => onCopy(d.text)}
                  onDelete={() => onDeleteDraft(d)}
                />
              ))
            )
          ) : transcripts.length === 0 ? (
            <EmptyState
              icon="mic-outline"
              title="No transcripts yet"
              hint="Record a voice note in Dictation — it will land here automatically."
            />
          ) : (
            transcripts.map((t, i) => (
              <TranscriptCard
                key={t.id}
                t={t}
                index={i}
                expanded={!!expanded[t.id]}
                onToggle={() => toggleExpand(t.id)}
                onCopy={() => onCopy(t.text)}
                onExport={() => onExportTranscript(t)}
                onDelete={() => onDeleteTranscript(t)}
              />
            ))
          )}

          {error ? (
            <View style={styles.errorBox} testID="library-error-box">
              <Text style={styles.errorTxt}>! {error}</Text>
            </View>
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ========== SUB COMPONENTS ========== */

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
}) {
  return (
    <View style={styles.empty} testID="library-empty">
      <Ionicons name={icon} size={28} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

function DraftCard({
  draft,
  index,
  expanded,
  onToggle,
  onOpen,
  onCopy,
  onDelete,
}: {
  draft: DraftRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const preview = draft.text.slice(0, expanded ? 8000 : 180);
  const wordCount = draft.text.trim() ? draft.text.trim().split(/\s+/).length : 0;
  return (
    <View style={styles.card} testID={`draft-card-${index}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIdx}>
          <Text style={styles.cardIdxTxt}>{String(index + 1).padStart(2, '0')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {draft.title || 'Untitled draft'}
          </Text>
          <Text style={styles.cardMeta}>
            {wordCount} words · {formatDate(draft.created_at)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onToggle}
          style={styles.iconChip}
          testID={`draft-expand-${index}`}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse draft' : 'Expand draft'}
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      <Text
        style={styles.cardBody}
        numberOfLines={expanded ? undefined : 3}
      >
        {preview}
        {!expanded && draft.text.length > 180 ? '…' : ''}
      </Text>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onOpen}
          testID={`draft-open-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Read "${draft.title || 'Untitled draft'}" in Readback`}
        >
          <Ionicons name="play-circle-outline" size={14} color={colors.amber} />
          <Text style={[styles.actionTxt, { color: colors.amber }]}>READ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onCopy}
          testID={`draft-copy-${index}`}
          accessibilityRole="button"
          accessibilityLabel="Copy draft text"
        >
          <Ionicons name="copy-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.actionTxt}>COPY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onDelete}
          testID={`draft-delete-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${draft.title || 'Untitled draft'}"`}
        >
          <Ionicons name="trash-outline" size={14} color={colors.red} />
          <Text style={[styles.actionTxt, { color: colors.red }]}>DELETE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TranscriptCard({
  t,
  index,
  expanded,
  onToggle,
  onCopy,
  onExport,
  onDelete,
}: {
  t: TranscriptRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const wc = t.text.trim() ? t.text.trim().split(/\s+/).length : 0;
  const preview = t.text.slice(0, expanded ? 8000 : 180);
  const title = t.text.split(/\s+/).slice(0, 6).join(' ') || 'Untitled capture';
  return (
    <View style={styles.card} testID={`transcript-card-${index}`}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIdx, { backgroundColor: colors.redDim }]}>
          <Ionicons name="radio-button-on" size={10} color={colors.red} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.cardMeta}>
            {wc} words · {formatDate(t.created_at)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onToggle}
          style={styles.iconChip}
          testID={`transcript-expand-${index}`}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse transcript' : 'Expand transcript'}
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardBodyMono} numberOfLines={expanded ? undefined : 3}>
        {preview}
        {!expanded && t.text.length > 180 ? '…' : ''}
      </Text>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onCopy}
          testID={`transcript-copy-${index}`}
          accessibilityRole="button"
          accessibilityLabel="Copy transcript text"
        >
          <Ionicons name="copy-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.actionTxt}>COPY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onExport}
          testID={`transcript-export-${index}`}
          accessibilityRole="button"
          accessibilityLabel="Export transcript as markdown"
        >
          <Ionicons name="download-outline" size={14} color={colors.amber} />
          <Text style={[styles.actionTxt, { color: colors.amber }]}>.MD</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onDelete}
          testID={`transcript-delete-${index}`}
          accessibilityRole="button"
          accessibilityLabel="Delete transcript"
        >
          <Ionicons name="trash-outline" size={14} color={colors.red} />
          <Text style={[styles.actionTxt, { color: colors.red }]}>DELETE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return `today ${d.getHours().toString().padStart(2, '0')}:${d
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  pillDot: { width: 5, height: 5, backgroundColor: colors.amber },
  pillTxt: { fontFamily: mono, fontSize: 9.5, letterSpacing: 2, color: colors.textMuted },

  segment: {
    flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14,
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderBottomWidth: 1.5, borderBottomColor: colors.border,
  },
  segmentBtnActive: {
    borderBottomColor: colors.amber,
  },
  segmentTxt: {
    fontFamily: mono, fontSize: 11, letterSpacing: 2, color: colors.textMuted,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: 14, marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10,
  },
  cardIdx: {
    width: 30, height: 30,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cardIdxTxt: {
    fontFamily: mono, fontSize: 11, letterSpacing: 1, color: colors.textMuted,
  },
  cardTitle: {
    fontFamily: sans, fontSize: 15, color: colors.textPrimary, fontWeight: '600',
  },
  cardMeta: {
    fontFamily: mono, fontSize: 10.5, color: colors.textMuted,
    letterSpacing: 1.2, marginTop: 3,
  },
  iconChip: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  cardBody: {
    fontFamily: sans, fontSize: 14, lineHeight: 21, color: colors.textSecondary,
    paddingBottom: 10,
  },
  cardBodyMono: {
    fontFamily: mono, fontSize: 13, lineHeight: 20, color: colors.textSecondary,
    paddingBottom: 10,
  },
  cardActions: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border, marginTop: 2, paddingTop: 10, gap: 8,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  actionTxt: {
    fontFamily: mono, fontSize: 10.5, letterSpacing: 1.6, color: colors.textSecondary,
  },

  empty: {
    alignItems: 'center', paddingVertical: 48, gap: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderStyle: 'dashed', backgroundColor: colors.panel,
  },
  emptyTitle: {
    fontFamily: mono, fontSize: 13, letterSpacing: 1.6, color: colors.textSecondary,
  },
  emptyHint: {
    fontFamily: sans, fontSize: 13, color: colors.textMuted,
    textAlign: 'center', paddingHorizontal: 24, lineHeight: 19,
  },
  errorBox: {
    marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.red,
    backgroundColor: colors.redDim, padding: 10,
  },
  errorTxt: { fontFamily: mono, fontSize: 12, color: colors.red },
});
