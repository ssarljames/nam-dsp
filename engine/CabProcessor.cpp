#include "CabProcessor.h"

#include <cmath>

#include "DspMath.h"

void CabProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    gain_.prepare(sampleRate, kSmoothingMs);
    gain_.snapTo(1.0f);
    reset();
}

void CabProcessor::reset() {
    for (float& v : history_) v = 0.0f;
    position_ = 0;
    gain_.snapTo(gain_.target());
}

void CabProcessor::setParams(const float* params) {
    gain_.setTarget(dbToLinear(params[0]));
}

bool CabProcessor::loadIr(int32_t length) {
    if (length < 0 || length > kMaxTaps) return false;
    for (int32_t i = 0; i < length; ++i) {
        if (!std::isfinite(staging_[i])) return false;
    }
    for (int32_t i = 0; i < length; ++i) taps_[i] = staging_[i];
    for (int32_t i = length; i < kMaxTaps; ++i) taps_[i] = 0.0f;
    length_ = length;
    return true;
}

void CabProcessor::process(float* buffer, int32_t numFrames) {
    // taps_ is zero beyond length_, so rounding up to a whole four adds
    // nothing to the sum.
    const int32_t padded = (length_ + 3) & ~3;

    for (int32_t n = 0; n < numFrames; ++n) {
        float x = buffer[n];
        // Written so that NaN, whose comparisons are all false, is flushed too.
        if (!(std::fabs(x) >= kInputFlush)) x = 0.0f;

        position_ = position_ == 0 ? kMaxTaps - 1 : position_ - 1;
        history_[position_] = x;
        history_[position_ + kMaxTaps] = x;

        // The history is written even with no IR, so one loaded mid-play
        // convolves against real recent input instead of ramping in.
        if (padded == 0) continue;

        // history_[position_ + k] is the input k samples ago. Four independent
        // accumulators, so the loop vectorises without needing -ffast-math to
        // reorder a single running sum.
        const float* h = history_ + position_;
        float a0 = 0.0f;
        float a1 = 0.0f;
        float a2 = 0.0f;
        float a3 = 0.0f;
        for (int32_t k = 0; k < padded; k += 4) {
            a0 += taps_[k] * h[k];
            a1 += taps_[k + 1] * h[k + 1];
            a2 += taps_[k + 2] * h[k + 2];
            a3 += taps_[k + 3] * h[k + 3];
        }
        buffer[n] = ((a0 + a1) + (a2 + a3)) * gain_.next();
    }
}
