import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiServerInfo } from '../transport';

/** Only public destination information. Never show account/session values here. */
export function ApiServerNotice({ origin, nonProductionOnly = false }: { origin: string; nonProductionOnly?: boolean }) {
  const server = apiServerInfo(origin, __DEV__);
  if (nonProductionOnly && server.isProduction) return null;
  return <View style={styles.notice}>
    <Text accessibilityRole="header" style={styles.heading}>{server.isProduction ? 'Production server' : 'Non-production server'}</Text>
    <Text selectable style={styles.origin}>{server.origin}</Text>
    {!nonProductionOnly && !server.isProduction && <Text style={styles.detail}>Use only the test account and actions approved for this server. Planning may be unavailable.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  notice: { backgroundColor: '#DCEABD', borderColor: '#B6D382', borderWidth: 1, borderRadius: 12, marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  heading: { color: '#183B35', fontFamily: 'Manrope_700Bold', fontSize: 12, lineHeight: 18 },
  origin: { color: '#183B35', fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 18 },
  detail: { color: '#183B35', fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20 },
});
