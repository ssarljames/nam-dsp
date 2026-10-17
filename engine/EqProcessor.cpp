#include "EqProcessor.h"

#include <cmath>

#include "DspMath.h"

namespace {
constexpr double kPi = 3.14159265358979323846;

BiquadCoeffs normalise(double b0, double b1, double b2, double a0, double a1, double a2) {
    BiquadCoeffs c;
    c.b0 = b0 / a0;
    c.b1 = b1 / a0;
    c.b2 = b2 / a0;
    c.a1 = a1 / a0;
    c.a2 = a2 / a0;
    return c;
}
}  // namespace

BiquadCoeffs makePeaking(double freqHz, double q, double sampleRate, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * freqHz / sampleRate;
    const double cosw0 = std::cos(w0);
    const double alpha = std::sin(w0) / (2.0 * q);

    return normalise(1.0 + alpha * A, -2.0 * cosw0, 1.0 - alpha * A,
                     1.0 + alpha / A, -2.0 * cosw0, 1.0 - alpha / A);
}

BiquadCoeffs makeLowShelf(double freqHz, double sampleRate, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * freqHz / sampleRate;
    const double cosw0 = std::cos(w0);
    // S = 1 collapses the cookbook's alpha to sin(w0)/2 * sqrt(2).
    const double alpha = std::sin(w0) / 2.0 * std::sqrt(2.0);
    const double twoSqrtAlpha = 2.0 * std::sqrt(A) * alpha;

    return normalise(A * ((A + 1.0) - (A - 1.0) * cosw0 + twoSqrtAlpha),
                     2.0 * A * ((A - 1.0) - (A + 1.0) * cosw0),
                     A * ((A + 1.0) - (A - 1.0) * cosw0 - twoSqrtAlpha),
                     (A + 1.0) + (A - 1.0) * cosw0 + twoSqrtAlpha,
                     -2.0 * ((A - 1.0) + (A + 1.0) * cosw0),
                     (A + 1.0) + (A - 1.0) * cosw0 - twoSqrtAlpha);
}

BiquadCoeffs makeHighShelf(double freqHz, double sampleRate, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * freqHz / sampleRate;
    const double cosw0 = std::cos(w0);
    const double alpha = std::sin(w0) / 2.0 * std::sqrt(2.0);
    const double twoSqrtAlpha = 2.0 * std::sqrt(A) * alpha;

    return normalise(A * ((A + 1.0) + (A - 1.0) * cosw0 + twoSqrtAlpha),
                     -2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0),
                     A * ((A + 1.0) + (A - 1.0) * cosw0 - twoSqrtAlpha),
                     (A + 1.0) - (A - 1.0) * cosw0 + twoSqrtAlpha,
                     2.0 * ((A - 1.0) - (A + 1.0) * cosw0),
                     (A + 1.0) - (A - 1.0) * cosw0 - twoSqrtAlpha);
}

void EqProcessor::prepare(double sampleRate, int32_t maxBlockSize) {
    sampleRate_ = sampleRate;

    const double blockRate = sampleRate / static_cast<double>(maxBlockSize > 0 ? maxBlockSize : 128);
    bassDb_.prepare(blockRate, kSmoothingMs);
    midDb_.prepare(blockRate, kSmoothingMs);
    trebleDb_.prepare(blockRate, kSmoothingMs);

    bassDb_.snapTo(0.0f);
    midDb_.snapTo(0.0f);
    trebleDb_.snapTo(0.0f);

    level_.prepare(sampleRate, kLevelSmoothingMs);
    // Unity, so a freshly prepared EQ never fades in from silence.
    level_.snapTo(1.0f);
    // Force the first computation regardless of the epsilon.
    lastBassDb_ = lastMidDb_ = lastTrebleDb_ = 1000.0f;
    updateCoefficients();
    reset();
}

void EqProcessor::reset() {
    bass_.reset();
    mid_.reset();
    treble_.reset();
    level_.snapTo(level_.target());
}

void EqProcessor::setParams(const float* params) {
    bassDb_.setTarget(params[0]);
    midDb_.setTarget(params[1]);
    trebleDb_.setTarget(params[2]);
    level_.setTarget(dbToLinear(params[3]));
}

void EqProcessor::updateCoefficients() {
    const float b = bassDb_.current();
    const float m = midDb_.current();
    const float t = trebleDb_.current();

    if (std::fabs(b - lastBassDb_) > kRecomputeEpsilonDb) {
        bass_.c = makeLowShelf(kBassFreq, sampleRate_, b);
        lastBassDb_ = b;
    }
    if (std::fabs(m - lastMidDb_) > kRecomputeEpsilonDb) {
        mid_.c = makePeaking(kMidFreq, kMidQ, sampleRate_, m);
        lastMidDb_ = m;
    }
    if (std::fabs(t - lastTrebleDb_) > kRecomputeEpsilonDb) {
        treble_.c = makeHighShelf(kTrebleFreq, sampleRate_, t);
        lastTrebleDb_ = t;
    }
}

void EqProcessor::process(float* buffer, int32_t numFrames) {
    // One smoothing step per block, then at most three coefficient updates.
    bassDb_.next();
    midDb_.next();
    trebleDb_.next();
    updateCoefficients();

    for (int32_t i = 0; i < numFrames; ++i) {
        const double x = static_cast<double>(buffer[i]);
        const float y = static_cast<float>(treble_.process(mid_.process(bass_.process(x))));
        buffer[i] = y * level_.next();
    }
}
