import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';

/**
 * The centred section heading that names the choice a page is asking for —
 * "LAUNDRY TYPE" on the Home page, "ORDER TYPE" on the page after it.
 *
 * IT LIVES HERE BECAUSE TWO PAGES SHOW IT. The Order Type page is a direct
 * continuation of the Home page's question, so the two headings have to be
 * the same object rather than the same recipe followed twice: a size or a
 * stroke changed on one and missed on the other is exactly the drift this
 * component exists to prevent.
 *
 * The plate carries a hairline black frame; the letters carry their own teal
 * outline. Two different edges doing two different jobs — the frame separates
 * the plate from the page, the outline draws each letter on it.
 *
 * ============================================================
 * HOW THE OUTLINE IS DRAWN, AND WHY NOT WITH A SHADOW
 * ============================================================
 *
 * React Native has no `text-stroke`. The obvious substitute is a zero-offset
 * `textShadow` with a small radius, and it does not work: a shadow is a BLUR,
 * so at a radius tight enough to hug the letters it is too faint to see, and
 * at a radius strong enough to see it is a halo rather than an edge. A `Text`
 * also gets only one shadow — RN takes no shadow list — so it cannot be
 * stacked into something crisper.
 *
 * So the outline is real geometry instead: the same string is drawn EIGHT
 * times in the stroke colour, nudged one pixel out in each of the eight
 * compass directions, with the white fill laid over the top. Each copy pokes
 * exactly 1px past the fill on its own side, and together they ring every
 * glyph — including the counters inside O, D and R — with a hairline that
 * follows the letterform instead of smudging around it.
 *
 * The copies MUST share `styles.text` with the fill: identical family, size,
 * weight and letterSpacing are what keep the nine layers in register. Change
 * the type here, not on the fill alone.
 */

/** The teal the outline is drawn in — the same teal as the cards below it. */
const STROKE_COLOR = '#3D6F73';

/** How far each copy is nudged. One pixel: thin and clean, never a slab. */
const STROKE_WIDTH = 1;

/** The eight directions, so the ring around each glyph has no gaps. */
const STROKE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

interface Props {
  /** The heading itself. Cased by the caller; the style does not transform it. */
  children: string;
  /** Spacing overrides for the wrapper, e.g. a different gap to the cards. */
  style?: StyleProp<ViewStyle>;
}

export default function SectionHeading({ children, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.pill}>
        {/* The fill sits in normal flow and is what gives this box its size;
            the outline copies are absolute, so they add nothing to the
            layout and the pill stays exactly as wide as the word. */}
        <View>
          {STROKE_OFFSETS.map(([dx, dy]) => (
            <Text
              key={`${dx},${dy}`}
              style={[
                styles.text,
                styles.strokeLayer,
                { left: dx * STROKE_WIDTH, top: dy * STROKE_WIDTH },
              ]}
              // One heading, not nine: the copies are paint, and a screen
              // reader must never meet them.
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              {children}
            </Text>
          ))}
          <Text style={styles.text}>{children}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Tight on purpose: on the Home page this heading and the two cards
    // under it are competing for one screen's height.
    marginBottom: SPACING.sm,
  },
  pill: {
    backgroundColor: '#ffbd4a',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    // A hairline frame around the saffron plate. 1px on purpose: at 2 it
    // stops reading as an edge and starts reading as a box.
    borderWidth: 1,
    borderColor: '#000000',
    ...SHADOWS.light,
  },
  text: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  // Behind the fill, and out of the layout. `right: 0` alongside `left`
  // would fight the offset, so only left/top are set — by the caller.
  strokeLayer: {
    position: 'absolute',
    color: STROKE_COLOR,
  },
});
