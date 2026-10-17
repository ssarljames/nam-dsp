#include "DelayProcessor.h"

#include <cmath>

namespace {

float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

void DelayProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;

    const double samplesAtMaxTime = sampleRate_ * kMaxTimeMs * 0.001;
    maxDelaySamples_ = samplesAtMaxTime < static_cast<double>(kMaxDelaySamples)
                           ? static_cast<int32_t>(samplesAtMaxTime)
                           : kMaxDelaySamples;

    level_.prepare(sampleRate_, kGainSmoothingMs);
    feedback_.prepare(sampleRate_, kGainSmoothingMs);
    timeMs_.prepare(sampleRate_, kTimeSmoothingMs);
    level_.snapTo(0.0f);
    feedback_.snapTo(0.0f);
    timeMs_.snapTo(kDefaultTimeMs);
    reset();
}

void DelayProcessor::reset() {
    for (float& v : line_) v = 0.0f;
    writeIndex_ = 0;
    primed_ = false;
}

void DelayProcessor::setParams(const float* params) {
    const float level = clampf(finiteOr(params[0], 0.0f), 0.0f, 100.0f) * 0.01f;
    const float time = clampf(finiteOr(params[1], kDefaultTimeMs), kMinTimeMs, kMaxTimeMs);
    const float feedback = clampf(finiteOr(params[2], 0.0f), 0.0f, kMaxFeedbackPercent) * 0.01f;

    level_.setTarget(level);
    feedback_.setTarget(feedback);
    timeMs_.setTarget(time);

    if (!primed_) {
        level_.snapTo(level);
        feedback_.snapTo(feedback);
        timeMs_.snapTo(time);
        primed_ = true;
    }
}

void DelayProcessor::process(float* buffer, int32_t numFrames) {
    const float maxSamples = static_cast<float>(maxDelaySamples_);
    const float samplesPerMs = static_cast<float>(sampleRate_ * 0.001);

    for (int32_t n = 0; n < numFrames; ++n) {
        float x = buffer[n];
        // Written so that NaN, whose comparisons are all false, is flushed too.
        if (!std::isfinite(x) || std::fabs(x) < kFlush) x = 0.0f;

        float delay = timeMs_.next() * samplesPerMs;
        if (delay > maxSamples) delay = maxSamples;
        if (delay < 1.0f) delay = 1.0f;

        // Split into whole samples and a fraction, in integers, so a float
        // rounding error can never produce an out-of-range index.
        const int32_t whole = static_cast<int32_t>(delay);
        const float fraction = delay - static_cast<float>(whole);
        int32_t nearer = writeIndex_ - whole;
        if (nearer < 0) nearer += kLineSize;
        int32_t further = nearer - 1;
        if (further < 0) further += kLineSize;
        const float wet = line_[nearer] * (1.0f - fraction) + line_[further] * fraction;

        const float feedback = feedback_.next();
        const float level = level_.next();

        float stored = x + wet * feedback;
        if (!std::isfinite(stored) || std::fabs(stored) < kFlush) stored = 0.0f;
        line_[writeIndex_] = stored;

        buffer[n] = x + wet * level;

        if (++writeIndex_ >= kLineSize) writeIndex_ = 0;
    }
}
