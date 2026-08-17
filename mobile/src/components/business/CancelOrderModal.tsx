import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';

/**
 * Business Order Cancellation window.
 *
 * Reproduces the reference cancellation dialog: title, italic instruction,
 * a single-choice reason list, a free-text box that appears for "Others",
 * and the two text actions at the bottom right.
 */

const OTHERS = 'Others';

const REASONS = [
  'Pickup address changed',
  'No one here to pick my garments',
  'Prices are high',
  'Logistic not reached',
  OTHERS,
];

/** Palette taken from the reference dialog rather than the app theme. */
const C = {
  border: '#2196F3',
  title: '#12408C',
  instruction: '#9E9E9E',
  option: '#3C3C3C',
  radioIdle: '#9E9E9E',
  radioActive: '#2196F3',
  inputBorder: '#9E9E9E',
  inputText: '#3C3C3C',
  dismiss: '#E8442F',
  confirm: '#12408C',
  surface: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.45)',
  error: '#E8442F',
};

const MAX_REASON_LENGTH = 300;

interface Props {
  visible: boolean;
  isCancelling?: boolean;
  /** Server-side failure surfaced inside the window. */
  error?: string;
  /** Receives the chosen reason (the typed text when "Others" is picked). */
  onConfirm: (reason: string) => void;
  onDismiss: () => void;
}

export default function CancelOrderModal({
  visible,
  isCancelling,
  error,
  onConfirm,
  onDismiss,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [validation, setValidation] = useState('');

  // Reopening the window starts from a clean choice.
  useEffect(() => {
    if (visible) {
      setSelected(null);
      setOtherReason('');
      setValidation('');
    }
  }, [visible]);

  const handleConfirm = () => {
    if (isCancelling) return;

    if (!selected) {
      setValidation('Please select a reason for cancelling this order.');
      return;
    }

    if (selected === OTHERS) {
      const typed = otherReason.trim();
      if (!typed) {
        setValidation('Please specify a valid reason.');
        return;
      }
      setValidation('');
      onConfirm(typed.slice(0, MAX_REASON_LENGTH));
      return;
    }

    setValidation('');
    onConfirm(selected);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.scrim} onPress={isCancelling ? undefined : onDismiss}>
        {/* A tap inside the card must not close the window. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <ScrollView
            contentContainerStyle={styles.cardContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Cancelling Pickup?</Text>

            <Text style={styles.instruction}>
              Please let us know why you decided to cancel scheduled pickup, by choosing one of the
              options given below
            </Text>

            <View style={styles.options}>
              {REASONS.map((reason) => {
                const isSelected = selected === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    style={styles.optionRow}
                    onPress={() => {
                      setSelected(reason);
                      setValidation('');
                    }}
                    disabled={isCancelling}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={reason}
                  >
                    <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                      {isSelected ? <View style={styles.radioInner} /> : null}
                    </View>
                    <Text style={styles.optionText}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {selected === OTHERS ? (
              <TextInput
                style={styles.otherInput}
                placeholder={'As you have selected "Others" Please specify a valid reason'}
                placeholderTextColor={C.inputText}
                value={otherReason}
                onChangeText={(text) => {
                  setOtherReason(text);
                  setValidation('');
                }}
                editable={!isCancelling}
                multiline
                maxLength={MAX_REASON_LENGTH}
                textAlignVertical="top"
              />
            ) : null}

            {validation || error ? (
              <Text style={styles.errorText}>{validation || error}</Text>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={onDismiss}
                disabled={isCancelling}
                activeOpacity={0.7}
                style={styles.actionButton}
              >
                <Text style={styles.dismissText}>No, Thanks</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleConfirm}
                disabled={isCancelling}
                activeOpacity={0.7}
                style={styles.actionButton}
              >
                {isCancelling ? (
                  <ActivityIndicator size="small" color={C.confirm} />
                ) : (
                  <Text style={styles.confirmText}>Cancel Pickup</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: C.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: C.surface,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: C.border,
  },
  cardContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: 'bold',
    color: C.title,
    marginBottom: SPACING.md,
  },
  instruction: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontStyle: 'italic',
    color: C.instruction,
    lineHeight: 24,
    marginBottom: SPACING.lg,
  },
  options: { gap: SPACING.md },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingRight: SPACING.sm,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.radioIdle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: C.radioActive },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.radioActive },
  optionText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    color: C.option,
    lineHeight: 26,
  },
  otherInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: BORDER_RADIUS.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    color: C.inputText,
    lineHeight: 24,
  },
  errorText: {
    marginTop: SPACING.md,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: C.error,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SPACING.xl,
    marginTop: SPACING.xl,
  },
  actionButton: { paddingVertical: SPACING.xs, minWidth: 90, alignItems: 'center' },
  dismissText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: C.dismiss,
  },
  confirmText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: C.confirm,
  },
});
