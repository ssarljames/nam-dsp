#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * The fixed cab simulator: direct time-domain FIR convolution against one
 * loaded impulse response, between the NAM and the EQ.
 *
 * params[0] of its slice is the engaged level in dB, applied as a smoothed gain
 * on the convolver's output. With no IR loaded the stage passes its input
 * through untouched, so enabling it before a file is chosen is harmless.
 *
 * Direct rather than FFT because the IRs in scope are short (guitar cab IRs
 * are typically 10-50 ms): no partitioning, no scratch allocation, and no
 * latency beyond the IR's own delay (spec 2026-09-24-cab-ir §3).
 */
class CabProcessor : public Processor {
public:
    /** ~85 ms at 48 kHz. A multiple of four: the dot product runs in fours. */
    static constexpr int32_t kMaxTaps = 4096;
    static_assert(kMaxTaps % 4 == 0, "the dot product consumes taps four at a time");

    /** Input below this (and NaN) is stored as zero, so history never holds denormals. */
    static constexpr float kInputFlush = 1.0e-20f;
    static constexpr double kSmoothingMs = 20.0;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

    /** Where the caller writes an IR's taps before calling loadIr(). */
    float* staging() { return staging_; }

    /**
     * Commits the first `length` staged floats as the IR. Rejects, changing
     * nothing, a length outside 0..kMaxTaps or any non-finite value. `0`
     * unloads the IR. Runs between process() calls, so process() never sees a
     * half-written tap array. The history is deliberately kept: an abrupt tap
     * change can click, which is the crossfade gap every stage shares.
     */
    bool loadIr(int32_t length);

    int32_t length() const { return length_; }

private:
    // Everything is a fixed member, so construction is the only allocation.
    float taps_[kMaxTaps] = {};  // zero beyond length_, always
    float staging_[kMaxTaps] = {};

    // The last kMaxTaps input samples, newest first, written twice (at i and
    // i + kMaxTaps) so the dot product reads one contiguous run with no modulo.
    float history_[2 * kMaxTaps] = {};
    int32_t position_ = 0;
    int32_t length_ = 0;

    SmoothedValue gain_;
};
