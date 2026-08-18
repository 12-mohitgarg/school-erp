/**
 * Icon.
 *
 * One family (Ionicons) and one named set, so a concept has exactly one glyph
 * across all three apps. Mixing families is the fastest way to make a product
 * look assembled rather than designed — the stroke weights never match.
 *
 * Names are semantic (`fees`, `sos`, `boarding`) rather than pictorial
 * (`wallet`, `alert`, `bus`) so the glyph can change without touching a
 * single call site.
 */

import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/design/ThemeProvider';
import type { TextTone } from './Text';

/** The subset of Ionicons this product uses, mapped to product concepts. */
export const ICONS = {
  // Navigation
  home: 'home',
  map: 'navigate-circle',
  attendance: 'checkmark-done-circle',
  results: 'ribbon',
  homework: 'reader',
  fees: 'wallet',
  chat: 'chatbubbles',
  bell: 'notifications',
  megaphone: 'megaphone',
  timetable: 'calendar',
  library: 'library',
  profile: 'person-circle',
  trip: 'bus',
  manifest: 'people',
  settings: 'settings',

  // Actions
  back: 'chevron-back',
  forward: 'chevron-forward',
  down: 'chevron-down',
  up: 'chevron-up',
  close: 'close',
  search: 'search',
  filter: 'options',
  refresh: 'refresh',
  send: 'send',
  attach: 'attach',
  camera: 'camera',
  document: 'document-text',
  logout: 'log-out',
  call: 'call',
  swap: 'swap-horizontal',

  // Status & safety
  sos: 'warning',
  shield: 'shield-checkmark',
  alert: 'alert-circle',
  info: 'information-circle',
  success: 'checkmark-circle',
  offline: 'cloud-offline',
  online: 'cloud-done',
  live: 'radio',
  clock: 'time',
  pin: 'location',
  speed: 'speedometer',
  boarding: 'enter',
  alighting: 'exit',
  absent: 'remove-circle',
  lock: 'lock-closed',
  eye: 'eye',
  moon: 'moon',
  sun: 'sunny',
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  tone?: TextTone;
  /** Overrides `tone`. Use for one-off colours such as a subject's own hue. */
  color?: string;
}

export function Icon({ name, size = 20, tone = 'default', color }: IconProps) {
  const { colors } = useTheme();

  const toneColor: Record<TextTone, string> = {
    default: colors.ink,
    muted: colors.inkMuted,
    subtle: colors.inkSubtle,
    brand: colors.brand600,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    onBrand: colors.onBrand,
    inherit: colors.ink,
  };

  return (
    <Ionicons
      name={ICONS[name]}
      size={size}
      color={color ?? toneColor[tone]}
      // Icons here are always paired with a label or an accessible parent, so
      // announcing them again would just make VoiceOver read everything twice.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
