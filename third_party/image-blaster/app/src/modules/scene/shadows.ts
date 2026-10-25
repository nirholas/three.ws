export const DEFAULT_SHADOW_CATCHER_OPACITY = 0.75
export const DEFAULT_SHADOW_CATCHER_COLOR = '#000000'

export function shadowCatcherOpacity(opacity = DEFAULT_SHADOW_CATCHER_OPACITY) {
  return Math.min(Math.max(opacity, 0), 1)
}

export function shadowCatcherColor(color = DEFAULT_SHADOW_CATCHER_COLOR) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_SHADOW_CATCHER_COLOR
}
