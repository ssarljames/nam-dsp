#pragma once

#include <cmath>

/**
 * Shared scalar maths for the processors. Deliberately header-only and free of
 * any state so both the host test build and emcc get the same inlined code.
 */

/** Anything at or below this is a mute, not a very quiet signal. */
inline constexpr float kMinusInfinityDb = -60.0f;

inline float dbToLinear(float db) {
    // A NaN target would latch SmoothedValue's gain at NaN forever (both of its
    // guards compare false against a NaN delta) — permanent silence until reload.
    if (!std::isfinite(db)) return 0.0f;
    return db <= kMinusInfinityDb ? 0.0f : std::pow(10.0f, db * 0.05f);
}
