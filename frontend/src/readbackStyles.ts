import { StyleSheet } from 'react-native';
import { colors, mono, type, sans } from './theme';

export const styles = StyleSheet.create({
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
