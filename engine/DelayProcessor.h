#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * A simple mono delay, between the cab and the EQ (spec 2026-09-25-delay-effect
 * §3). The dry signal always passes at full level; the repeats are added on top.
 *
 * params[0] level, in percent: how strong the repeats are added back (0..100).
 * params[1] time, in ms (20..1000), smoothed and read with linear interpolation
 *           so a change bends the pitch like a tape echo instead of clicking.
 * params[2] feedback, in percent (0..90): capped below 100 so the loop can never
 *           grow without bound.
 *
 * The line is a fixed member array, sized for one second at 48 kHz, so nothing
 * ever allocates in process() (the WASM heap cannot grow). Above 48 kHz the
 * longest time shrinks to fit rather than reading out of bounds.
 */
class DelayProcessor : public Processor {
public:
    /** One second at 48 kHz. */
    static constexpr int32_t kMaxDelaySamples = 48000;
    /** The interpolating read looks one sample further back than the delay. */
    static constexpr int32_t kLineSize = kMaxDelaySamples + 2;

    static constexpr float kMinTimeMs = 20.0f;
    static constexpr float kMaxTimeMs = 1000.0f;
    static constexpr float kDefaultTimeMs = 350.0f;
    static constexpr float kMaxFeedbackPercent = 90.0f;

    /** Values below this (and NaN) are stored as zero, so a decaying tail never reaches denormals. */
    static constexpr float kFlush = 1.0e-20f;

    static constexpr double kGainSmoothingMs = 20.0;
    static constexpr double kTimeSmoothingMs = 80.0;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

    /** The longest delay this sample rate allows, in samples. */
    int32_t maxDelaySamples() const { return maxDelaySamples_; }

private:
    float line_[kLineSize] = {};
    int32_t writeIndex_ = 0;
    int32_t maxDelaySamples_ = kMaxDelaySamples;
    double sampleRate_ = 48000.0;

    // False after prepare() and reset(). The chain only calls setParams() on
    // an enabled stage, so a stage that has just been switched on holds stale
    // targets; the first setParams() after a reset snaps to the real ones.
    bool primed_ = false;

    SmoothedValue level_;
    SmoothedValue feedback_;
    SmoothedValue timeMs_;
};
