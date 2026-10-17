#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * Smoothed linear gain. params[0] is the gain in dB.
 *
 * The smoother runs per sample, not per block: a k-rate step straight into the
 * multiply is exactly the zipper noise the Phase 1 gate listens for.
 */
class GainProcessor : public Processor {
public:
    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

private:
    static constexpr double kSmoothingMs = 20.0;
    SmoothedValue gain_;
};
