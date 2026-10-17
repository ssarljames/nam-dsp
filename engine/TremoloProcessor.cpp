#include "TremoloProcessor.h"

#include <cmath>

#include "DspMath.h"

namespace {

constexpr double kTwoPi = 6.283185307179586;

float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

void TremoloProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    levelDb_.prepare(sampleRate_, kLevelSmoothingMs);
    depth_.prepare(sampleRate_, kLevelSmoothingMs);
    rate_.prepare(sampleRate_, kRateSmoothingMs);
    edge_.prepare(sampleRate_, kEdgeSmoothingMs);
    levelDb_.snapTo(0.0f);
    depth_.snapTo(kDefaultDepthPercent * 0.01f);
    rate_.snapTo(kDefaultRateHz);
    reset();
}

void TremoloProcessor::reset() {
    phase_ = 0.0;
    edge_.snapTo(shape(wave_, 0.0));
    primed_ = false;
}

void TremoloProcessor::setParams(const float* params) {
    // A value that is not finite reads as the default. A clamp alone would turn
    // +inf level into +24 dB and +inf depth into a full chop.
    const float levelDb = clampf(finiteOr(params[0], 0.0f), kMinLevelDb, kMaxLevelDb);
    const float rate = clampf(finiteOr(params[1], kDefaultRateHz), kMinRateHz, kMaxRateHz);
    const float depth = clampf(finiteOr(params[2], kDefaultDepthPercent), 0.0f, 100.0f) * 0.01f;
    const float rawWave = clampf(finiteOr(params[3], 0.0f), 0.0f, static_cast<float>(kWaveCount - 1));
    wave_ = static_cast<Wave>(static_cast<int32_t>(std::lround(rawWave)));

    levelDb_.setTarget(levelDb);
    rate_.setTarget(rate);
    depth_.setTarget(depth);

    // The chain only calls setParams() on an enabled stage, so a stage that has
    // just been switched on holds stale targets; the first call after a reset
    // snaps to the real ones, and to the top of the real wave.
    if (!primed_) {
        levelDb_.snapTo(levelDb);
        rate_.snapTo(rate);
        depth_.snapTo(depth);
        edge_.snapTo(shape(wave_, phase_));
        primed_ = true;
    }
}

float TremoloProcessor::shape(Wave wave, double phase) {
    switch (wave) {
        case Wave::Sine:
            return static_cast<float>(0.5 - 0.5 * std::cos(kTwoPi * phase));
        case Wave::Triangle:
            return static_cast<float>(phase < 0.5 ? 2.0 * phase : 2.0 - 2.0 * phase);
        case Wave::Square:
            return phase < 0.5 ? 0.0f : 1.0f;
        case Wave::Saw:
            return static_cast<float>(1.0 - phase);
    }
    return 0.0f;
}

void TremoloProcessor::process(float* buffer, int32_t numFrames) {
    const double secondsPerSample = 1.0 / sampleRate_;

    for (int32_t n = 0; n < numFrames; ++n) {
        float x = buffer[n];
        // NaN, +inf and -inf all become zero.
        if (!std::isfinite(x)) x = 0.0f;

        // The wave through the edge smoother, so a jump (the square's, the
        // saw's, or a change of wave) becomes a ramp of a few milliseconds.
        edge_.setTarget(shape(wave_, phase_));
        const float u = edge_.next();
        const float level = dbToLinear(levelDb_.next());
        const float depth = depth_.next();
        buffer[n] = x * level * (1.0f - depth * u);

        phase_ += static_cast<double>(rate_.next()) * secondsPerSample;
        if (phase_ >= 1.0) phase_ -= 1.0;
    }
}
