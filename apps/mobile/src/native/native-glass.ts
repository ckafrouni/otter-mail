import { isGlassEffectAPIAvailable } from "expo-glass-effect";

/** iOS 26+ Liquid Glass: native headers float transparently over content. */
export const NATIVE_LIQUID_GLASS_SUPPORTED = isGlassEffectAPIAvailable();
