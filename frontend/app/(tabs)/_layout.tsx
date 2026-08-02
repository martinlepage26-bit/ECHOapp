import { Tabs } from 'expo-router';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, mono } from '../../src/theme';

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      style={[
        styles.tabLabel,
        { color: focused ? colors.textPrimary : colors.textMuted },
      ]}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="readback"
        options={{
          title: 'Readback',
          tabBarAccessibilityLabel: 'Readback',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconWrap}>
              <Ionicons name="headset-outline" size={20} color={color} />
              {focused ? <View style={styles.activeDot} /> : null}
            </View>
          ),
          tabBarLabel: ({ focused }) => <TabLabel label="READBACK" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dictation"
        options={{
          title: 'Dictation',
          tabBarAccessibilityLabel: 'Dictation',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconWrap}>
              <Ionicons name="mic-outline" size={20} color={color} />
              {focused ? <View style={styles.activeDot} /> : null}
            </View>
          ),
          tabBarLabel: ({ focused }) => <TabLabel label="DICTATION" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarAccessibilityLabel: 'Library',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconWrap}>
              <Ionicons name="albums-outline" size={20} color={color} />
              {focused ? <View style={styles.activeDot} /> : null}
            </View>
          ),
          tabBarLabel: ({ focused }) => <TabLabel label="LIBRARY" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.select({ ios: 84, default: 64 }),
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 24, default: 8 }),
  },
  tabLabel: {
    fontFamily: mono,
    fontSize: 10.5,
    letterSpacing: 2.2,
    marginTop: 2,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 24,
  },
  activeDot: {
    position: 'absolute',
    bottom: -6,
    width: 4,
    height: 4,
    backgroundColor: colors.amber,
  },
});
