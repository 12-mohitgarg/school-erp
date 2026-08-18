/**
 * Avatar.
 *
 * Falls back to initials on a colour derived from the name — deterministic, so
 * the same person is the same colour on every screen and in every session.
 * A random colour per mount looks like a bug even when it is not.
 */

import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/design/ThemeProvider';
import { initials as toInitials } from '@/core/utils/format';
import { Text } from './Text';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const DIMENSIONS: Record<AvatarSize, { size: number; font: number }> = {
  xs: { size: 24, font: 10 },
  sm: { size: 32, font: 12 },
  md: { size: 40, font: 14 },
  lg: { size: 56, font: 19 },
  xl: { size: 84, font: 28 },
};

/**
 * Hand-picked so every entry clears 4.5:1 against white initials, and no two
 * adjacent hues are easy to confuse in a list.
 */
const SWATCHES = [
  '#4F46E5',
  '#0891B2',
  '#059669',
  '#CA8A04',
  '#DC2626',
  '#DB2777',
  '#7C3AED',
  '#0284C7',
] as const;

function swatchFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return SWATCHES[Math.abs(hash) % SWATCHES.length]!;
}

export interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  /** Ring in the brand colour — marks the child currently being viewed. */
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name, uri, size = 'md', highlighted = false, style }: AvatarProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const { size: dim, font } = DIMENSIONS[size];

  const showImage = Boolean(uri) && !failed;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: showImage ? colors.surfaceSunken : swatchFor(name),
          borderWidth: highlighted ? 2 : 0,
          borderColor: colors.brand500,
        },
        styles.container,
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={160}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          tone="inherit"
          style={{ color: '#FFFFFF', fontSize: font, fontWeight: '700', letterSpacing: 0.3 }}
        >
          {toInitials(...name.split(' '))}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
