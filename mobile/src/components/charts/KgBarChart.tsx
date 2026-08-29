import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, TouchableOpacity } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { CHART } from '../../constants/chartTheme';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';

/**
 * Months of laundry weight, as bars.
 *
 * MEASURED, NOT SCROLLED. The chart fits the width it is given, taken from
 * `onLayout` and rendered only once that width is known — the same approach
 * as `RevenueLineChart`, and for the same reason.
 *
 * An earlier version put the <Svg> inside a horizontal ScrollView so a long
 * series could scroll. Nested inside the page's own ScrollView that collapsed
 * to zero height and the chart did not appear at all. A chart that fits is
 * worth more than one that scrolls and cannot be seen; twelve months across a
 * phone is about 26px per bar, which is legible and still tappable.
 *
 * ONE SERIES, ONE COLOUR. Weight is a MAGNITUDE, not a set of categories —
 * every bar means the same thing — so colouring bars differently would imply
 * a distinction that does not exist. `CHANNEL_COLORS` is deliberately not
 * used: that pair encodes B2B vs B2C identity, and borrowing one would say
 * this chart is about a channel. The cyan is reused as a single accent
 * because it already clears the contrast and chroma floors for this surface,
 * which the brand green does not.
 *
 * SELECTION, NOT HOVER. A phone has no hover, so the detail a desktop would
 * show on hover appears when a bar is TAPPED and stays until another is
 * tapped. The touch targets are absolutely positioned over the plot, in the
 * same coordinate space as the bars, so they cannot drift out of alignment.
 */

export interface KgBar {
  /** 'YYYY-MM'. */
  month: string;
  /** 'August 2026'. */
  label: string;
  orders: number;
  items: number;
  total_kg: number;
  /** Only on the all-customers report. */
  customers?: number;
}

interface Props {
  bars: KgBar[];
  height?: number;
  /** Shown in the tapped-bar readout when the report has customer counts. */
  showCustomers?: boolean;
}

/** Compact kilograms for axis ticks: 1234 -> 1.2t, 250 -> 250 */
export function formatKgShort(value: number): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}t`;
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

export function formatKg(value: number): string {
  return `${(Number(value) || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 3,
  })} kg`;
}

const BAR_COLOR = '#0891B2';
const BAR_COLOR_SELECTED = '#0E7490';

const PAD_LEFT = 38;
const PAD_RIGHT = 6;
const PAD_TOP = 12;
const PAD_BOTTOM = 30;

export default function KgBarChart({ bars, height = 200, showCustomers }: Props) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotHeight = Math.max(0, height - PAD_TOP - PAD_BOTTOM);

  const { max, ticks } = useMemo(() => {
    const highest = Math.max(0, ...bars.map((b) => b.total_kg));
    // A flat-zero series would divide by zero, so keep a floor.
    if (highest <= 0) return { max: 1, ticks: [0, 1] };
    /*
     * A ROUND CEILING, so the axis reads 0/50/100/150/200 rather than
     * 0/37.7/75.4. The magnitude comes from the tallest bar and the ceiling
     * is rounded up past it, which also stops that bar touching the top.
     */
    const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));
    const step = highest / magnitude > 5 ? magnitude * 2
      : highest / magnitude > 2 ? magnitude
        : magnitude / 2;
    const ceiling = Math.ceil(highest / step) * step;
    const out: number[] = [];
    for (let v = 0; v <= ceiling + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
    return { max: ceiling, ticks: out };
  }, [bars]);

  const y = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;
  const slot = plotWidth / Math.max(bars.length, 1);
  // A gap between bars, but never so wide that the bar itself disappears.
  const barWidth = Math.max(Math.min(slot - CHART.markGap * 2, 40), 4);

  const active = bars.find((b) => b.month === selected) || null;

  if (bars.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No months to show.</Text>
      </View>
    );
  }

  return (
    <View>
      {/* The measured container. `width > 0` gates the render so the first
          pass never draws with a zero-width plot. */}
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 && (
          <>
            <Svg width={width} height={height}>
              {/* Grid and value axis. Recessive, per the chart tokens. */}
              {ticks.map((tick) => (
                <React.Fragment key={tick}>
                  <Line
                    x1={PAD_LEFT}
                    y1={y(tick)}
                    x2={PAD_LEFT + plotWidth}
                    y2={y(tick)}
                    stroke={CHART.gridLine}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={PAD_LEFT - 5}
                    y={y(tick) + 3}
                    fontSize={9}
                    fill={CHART.axisText}
                    textAnchor="end"
                  >
                    {formatKgShort(tick)}
                  </SvgText>
                </React.Fragment>
              ))}

              {/* The baseline, over the grid, so zero is unambiguous. */}
              <Line
                x1={PAD_LEFT}
                y1={y(0)}
                x2={PAD_LEFT + plotWidth}
                y2={y(0)}
                stroke={CHART.axisLine}
                strokeWidth={1}
              />

              {bars.map((bar, index) => {
                const x = PAD_LEFT + index * slot + (slot - barWidth) / 2;
                const top = y(bar.total_kg);
                const isOn = bar.month === selected;
                return (
                  <React.Fragment key={bar.month}>
                    {/* A month with no orders draws no bar — only its label —
                        so an empty month reads as zero rather than as a
                        one-pixel sliver that looks like a rounding artefact. */}
                    {bar.total_kg > 0 && (
                      <Rect
                        x={x}
                        y={top}
                        width={barWidth}
                        height={Math.max(y(0) - top, 1)}
                        rx={CHART.barRadius}
                        fill={isOn ? BAR_COLOR_SELECTED : BAR_COLOR}
                      />
                    )}
                    {/* The month, abbreviated: "August 2026" -> "Aug". */}
                    <SvgText
                      x={PAD_LEFT + index * slot + slot / 2}
                      y={height - PAD_BOTTOM + 13}
                      fontSize={9}
                      fill={isOn ? CHART.valueText : CHART.axisText}
                      textAnchor="middle"
                    >
                      {bar.label.slice(0, 3)}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </Svg>

            {/* The tap targets, absolutely positioned over the plot in the
                SAME coordinate space as the bars — so they cannot drift out
                of alignment, which an separately-scrolled row could. They sit
                outside the SVG because react-native-svg's own touch handling
                is inconsistent across platforms and a report has to be
                tappable on both. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {bars.map((bar, index) => (
                <TouchableOpacity
                  key={bar.month}
                  style={{
                    position: 'absolute',
                    left: PAD_LEFT + index * slot,
                    top: PAD_TOP,
                    width: slot,
                    height: plotHeight + PAD_BOTTOM,
                  }}
                  onPress={() => setSelected(bar.month === selected ? null : bar.month)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${bar.label}: ${formatKg(bar.total_kg)}, ${bar.orders} orders, ` +
                    `${bar.items} items`
                  }
                />
              ))}
            </View>
          </>
        )}
      </View>

      {/* The readout for the tapped bar. Reserved space, so the table below
          does not jump as bars are tapped. */}
      <View style={styles.readout}>
        {active ? (
          <>
            <Text style={styles.readoutTitle}>{active.label}</Text>
            <Text style={styles.readoutLine}>
              {formatKg(active.total_kg)} · {active.orders} order
              {active.orders === 1 ? '' : 's'} · {active.items} item
              {active.items === 1 ? '' : 's'}
              {showCustomers && active.customers !== undefined
                ? ` · ${active.customers} customer${active.customers === 1 ? '' : 's'}`
                : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.readoutHint}>Tap a bar for that month's detail.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: COLORS.TextSecondary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  readout: {
    minHeight: 38,
    justifyContent: 'center',
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.xs,
  },
  readoutTitle: {
    color: COLORS.TextPrimary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontWeight: '700',
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  readoutLine: {
    color: COLORS.TextSecondary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 1,
  },
  readoutHint: {
    color: COLORS.TextSecondary,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontStyle: 'italic',
  },
});
