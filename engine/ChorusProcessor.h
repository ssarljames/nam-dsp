#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * A mono chorus, beside the delay between the cab and the EQ (spec
 * 2026-09-25-chorus-effect §3.2). The dry signal always passes at full level;
 * one copy, delayed by a short and slowly swept time, is added on top.
 *
 * params[0] level, in percent (0..100): how strongly the swept copy is added.
 * params[1] rate, in Hz (0.05..5): the speed of the sweep.
 * params[2] depth, in percent (0..100): 0 is a fixed 12 ms, 100 sweeps +-6 ms.
 *
 * The delay is 12 ms + depth x 6 ms x sin(2 pi phase), so 6 to 18 ms; the
 * phase advances by rate / sampleRate per sample and wraps. All three params
 * are smoothed and the line is read with linear interpolation, so turning a
 * knob never zippers. The line is a fixed member array, so nothing allocates
 * in process().
 */
class ChorusProcessor : public Processor {
public:
    /** 18 ms at up to 96 kHz (1728 samples) with plenty of headroom. */
    static constexpr int32_t kLineSize = 4096;

    static constexpr float kBaseDelayMs = 12.0f;
    static constexpr float kSweepMs = 6.0f;
    static constexpr float kMinRateHz = 0.05f;
    static constexpr float kMaxRateHz = 5.0f;
    static constexpr float kDefaultRateHz = 0.8f;

    /** Input below this (and NaN or infinity) is stored as zero. */
    static constexpr float kFlush = 1.0e-20f;

    static constexpr double kLevelSmoothingMs = 20.0;
    static constexpr double kSweepSmoothingMs = 50.0;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

private:
    float line_[kLineSize] = {};
    int32_t writeIndex_ = 0;
    double sampleRate_ = 48000.0;
    /** Where the sweep is, in cycles (0..1). A double, so it does not drift. */
    double phase_ = 0.0;

    // False after prepare() and reset(). The chain only calls setParams() on
    // an enabled stage, so a stage that has just been switched on holds stale
    // targets; the first setParams() after a reset snaps to the real ones.
    bool primed_ = false;

    SmoothedValue level_;
    SmoothedValue rate_;
    SmoothedValue depth_;
};
