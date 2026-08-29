import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';

/**
 * Super Admin -> REPORT.
 *
 * The hub the REPORT tab opens. It lists report SECTIONS; KG REPORT is the
 * first, and its three reports live one screen down. A second section later
 * slots in beside this one rather than forcing a redesign.
 *
 * Nothing is fetched here — this screen only routes. Every figure lives
 * behind the report it belongs to, which keeps the hub instant and means a
 * report's own loading and error states are its own business.
 */
export default function SuperAdminReportsScreen({ navigation }: any) {
  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>Reports</Text>
      </View>

      <ScrollView contentContainerStyle={sa.scroll}>
        {/* KG REPORT: the section, not a report. Its three reports live
            one screen down, so a second section later is one more card
            here rather than a growing wall of headings. */}
        <ReportCard
          icon="scale-outline"
          title="KG REPORT"
          subtitle="Clothes weight — per customer, total, and item wise"
          onPress={() => navigation.navigate('SuperAdminKgReportHub')}
        />

        {/* OUTSTANDING: a report in its own right, not a KG one, so it sits
            beside KG REPORT rather than inside it. */}
        <ReportCard
          icon="cash-outline"
          title="OUTSTANDING"
          subtitle="What each establishment still owes"
          onPress={() => navigation.navigate('SuperAdminOutstandingReport')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportCard({
  icon, title, subtitle, onPress,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[sa.card, { flexDirection: 'row', alignItems: 'center', gap: SPACING.md }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: BORDER_RADIUS.md,
          backgroundColor: COLORS.Accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={COLORS.PrimaryDark} />
      </View>
      <View style={sa.flex}>
        <Text style={sa.cardTitle}>{title}</Text>
        <Text style={sa.cardMeta}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.TextSecondary} />
    </TouchableOpacity>
  );
}
