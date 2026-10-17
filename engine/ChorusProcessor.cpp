#include "ChorusProcessor.h"

#include <cmath>

namespace {

constexpr double kTwoPi = 6.283185307179586;

float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

void ChorusProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    level_.prepare(sampleRate_, kLevelSmoothingMs);
    rate_.prepare(sampleRate_, kSweepSmoothingMs);
    depth_.prepare(sampleRate_, kSweepSmoothingMs);
    level_.snapTo(0.0f);
    rate_.snapTo(kDefaultRateHz);
    depth_.snapTo(0.0f);
    reset();
}

void ChorusProcessor::reset() {
    for (float& v : line_) v = 0.0f;
    writeIndex_ = 0;
    phase_ = 0.0;
    primed_ = false;
}

void ChorusProcessor::setParams(const float* params) {
    // A value that is not finite reads as the safest one: no copy, the default
    // rate, no sweep. A clamp alone would turn +inf depth into full depth.
    const float level = clampf(finiteOr(params[0], 0.0f), 0.0f, 100.0f) * 0.01f;
    const float rate = clampf(finiteOr(params[1], kDefaultRateHz), kMinRateHz, kMaxRateHz);
    const float depth = clampf(finiteOr(params[2], 0.0f), 0.0f, 100.0f) * 0.01f;

    level_.setTarget(level);
    rate_.setTarget(rate);
    depth_.setTarget(depth);

    if (!primed_) {
        level_.snapTo(level);
        rate_.snapTo(rate);
        depth_.snapTo(depth);
        primed_ = true;
    }
}

void ChorusProcessor::process(float* buffer, int32_t numFrames) {
    const float samplesPerMs = static_cast<float>(sampleRate_ * 0.001);
    const double secondsPerSample = 1.0 / sampleRate_;
    // The interpolating read also takes the sample one further back.
    constexpr float kLongest = static_cast<float>(kLineSize - 2);

    for (int32_t n = 0; n < numFrames; ++n) {
        float x = buffer[n];
        // NaN, +inf and -inf all become zero, as do values too small to matter.
        if (!std::isfinite(x) || std::fabs(x) < kFlush) x = 0.0f;

        const float level = level_.next();
        const float rate = rate_.next();
        const float depth = depth_.next();

        const float sweep = static_cast<float>(std::sin(kTwoPi * phase_));
        float delay = (kBaseDelayMs + depth * kSweepMs * sweep) * samplesPerMs;
        // Written so a NaN also lands on the floor.
        if (!(delay >= 1.0f)) delay = 1.0f;
        if (delay > kLongest) delay = kLongest;

        // Whole samples and a fraction, in integers, so a float rounding error
        // can never produce an out-of-range index.
        const int32_t whole = static_cast<int32_t>(delay);
        const float fraction = delay - static_cast<float>(whole);
        int32_t nearer = writeIndex_ - whole;
        if (nearer < 0) nearer += kLineSize;
        int32_t further = nearer - 1;
        if (further < 0) further += kLineSize;
        const float wet = line_[nearer] * (1.0f - fraction) + line_[further] * fraction;

        line_[writeIndex_] = x;
        buffer[n] = x + wet * level;

        if (++writeIndex_ >= kLineSize) writeIndex_ = 0;
        phase_ += static_cast<double>(rate) * secondsPerSample;
        if (phase_ >= 1.0) phase_ -= 1.0;
    }
}
