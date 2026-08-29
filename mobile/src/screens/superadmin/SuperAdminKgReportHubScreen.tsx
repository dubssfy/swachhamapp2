import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { sa } from './styles';

/**
 * KG REPORT — the three reports, as cards.
 *
 * Reached from the REPORT screen, which lists the report SECTIONS. Keeping
 * the section and its reports on separate screens means a second section
 * later is one more card on the screen above rather than a growing wall of
 * headings, and it matches the way every other Super Admin area nests.
 *
 * Nothing is fetched here — this screen only routes. Each report owns its
 * own filters, loading and error states, so nothing is shared that could
 * make one report's state leak into another's.
 */
export default function SuperAdminKgReportHubScreen({ navigation }: any) {
  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={[sa.headerTitle, sa.flex]}>KG Report</Text>
      </View>

      <ScrollView contentContainerStyle={sa.scroll}>
        <Text style={[sa.cardMeta, { marginBottom: SPACING.sm }]}>
          Clothes weight processed, from the order register.
        </Text>

        <ReportCard
          icon="business-outline"
          title="PER CUSTOMER KG"
          subtitle="Monthly customer KG"
          onPress={() => navigation.navigate('SuperAdminKgReport', { mode: 'customer' })}
        />
        <ReportCard
          icon="stats-chart-outline"
          title="TOTAL KG"
          subtitle="All business KG"
          onPress={() => navigation.navigate('SuperAdminKgReport', { mode: 'total' })}
        />
        <ReportCard
          icon="shirt-outline"
          title="ITEM WISE KG REPORT"
          subtitle="Item-wise pieces & KG"
          onPress={() => navigation.navigate('SuperAdminItemKgReport')}
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
