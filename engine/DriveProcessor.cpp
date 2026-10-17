#include "DriveProcessor.h"

#include <cmath>

#include "DspMath.h"

namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kLog2 = 0.6931471805599453;
/** Closer than this, the ADAA quotient is replaced by the curve at the midpoint. */
constexpr double kAdaaEpsilon = 1.0e-6;
/** Filter states below this are flushed, so a decaying tail ends in exact zeros. */
constexpr double kStateFlush = 1.0e-20;
/** A crossfade weight this close to 0 or 1 has arrived. */
constexpr double kWeightSnap = 1.0e-9;

float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

double flush(double v) { return std::fabs(v) < kStateFlush ? 0.0 : v; }

/** log(cosh(x)), written so a large |x| cannot overflow cosh. */
double logCosh(double x) {
    const double a = std::fabs(x);
    return a + std::log1p(std::exp(-2.0 * a)) - kLog2;
}

/** The coefficient of a one-pole high-pass at `hz`. */
double onePoleHighPass(double hz, double sampleRate) {
    const double rc = 1.0 / (2.0 * kPi * hz);
    const double dt = 1.0 / sampleRate;
    return rc / (rc + dt);
}

}  // namespace

double DriveProcessor::curve(Type type, double x) {
    switch (type) {
        case Type::Hard:
            return x < -1.0 ? -1.0 : (x > 1.0 ? 1.0 : x);
        case Type::Asym:
            return std::tanh(x + kAsymBias) - std::tanh(kAsymBias);
        case Type::Soft:
            break;
    }
    return std::tanh(x);
}

double DriveProcessor::antiderivative(Type type, double x) {
    switch (type) {
        case Type::Hard: {
            const double a = std::fabs(x);
            return a <= 1.0 ? 0.5 * x * x : a - 0.5;
        }
        case Type::Asym:
            return logCosh(x + kAsymBias) - x * std::tanh(kAsymBias);
        case Type::Soft:
            break;
    }
    return logCosh(x);
}

double DriveProcessor::adaa(Type type, double x, double x1) {
    const double dx = x - x1;
    if (std::fabs(dx) < kAdaaEpsilon) return curve(type, 0.5 * (x + x1));
    return (antiderivative(type, x) - antiderivative(type, x1)) / dx;
}

double DriveProcessor::levelMatch(Type type, double gain) {
    const double v = gain * kLevelReference;
    const double m = 0.5 * (std::fabs(curve(type, v)) + std::fabs(curve(type, -v)));
    return m > 0.0 ? kLevelReference / m : 1.0;
}

void DriveProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    tightenA_ = onePoleHighPass(kTightenHz, sampleRate_);
    dcA_ = onePoleHighPass(kDcBlockHz, sampleRate_);
    fadeStep_ = 1.0 / (kCrossfadeMs * 0.001 * sampleRate_);
    levelDb_.prepare(sampleRate_, kSmoothingMs);
    gainDb_.prepare(sampleRate_, kSmoothingMs);
    tone_.prepare(sampleRate_, kSmoothingMs);
    levelDb_.snapTo(0.0f);
    gainDb_.snapTo(kDefaultGainDb);
    tone_.snapTo(kDefaultTonePercent * 0.01f);
    reset();
}

void DriveProcessor::reset() {
    tightenX1_ = 0.0;
    tightenY1_ = 0.0;
    dcX1_ = 0.0;
    dcY1_ = 0.0;
    adaaX1_ = 0.0;
    z1_ = 0.0;
    z2_ = 0.0;
    toneForCoeffs_ = -1.0f;
    gainDbForCache_ = -1000.0f;
    for (int32_t i = 0; i < kTypeCount; ++i) weight_[i] = i == static_cast<int32_t>(type_) ? 1.0 : 0.0;
    primed_ = false;
}

void DriveProcessor::setParams(const float* params) {
    // A value that is not finite reads as the default. A clamp alone would turn
    // +inf gain into full gain.
    const float levelDb = clampf(finiteOr(params[0], 0.0f), kMinLevelDb, kMaxLevelDb);
    const float gainDb = clampf(finiteOr(params[1], kDefaultGainDb), kMinGainDb, kMaxGainDb);
    const float tone = clampf(finiteOr(params[2], kDefaultTonePercent), 0.0f, 100.0f) * 0.01f;
    const float rawType = clampf(finiteOr(params[3], 0.0f), 0.0f, static_cast<float>(kTypeCount - 1));
    type_ = static_cast<Type>(static_cast<int32_t>(std::lround(rawType)));

    levelDb_.setTarget(levelDb);
    gainDb_.setTarget(gainDb);
    tone_.setTarget(tone);

    // The chain only calls setParams() on an enabled stage, so a stage that has
    // just been switched on holds stale targets; the first call after a reset
    // snaps to the real ones, with no fade from the old type.
    if (!primed_) {
        levelDb_.snapTo(levelDb);
        gainDb_.snapTo(gainDb);
        tone_.snapTo(tone);
        for (int32_t i = 0; i < kTypeCount; ++i) weight_[i] = i == static_cast<int32_t>(type_) ? 1.0 : 0.0;
        primed_ = true;
    }
}

bool DriveProcessor::crossfading() const {
    for (int32_t i = 0; i < kTypeCount; ++i) {
        const double target = i == static_cast<int32_t>(type_) ? 1.0 : 0.0;
        if (weight_[i] != target) return true;
    }
    return false;
}

void DriveProcessor::updateTone(float t) {
    toneForCoeffs_ = t;
    double hz = kToneMinHz * std::pow(kToneRatio, static_cast<double>(t));
    const double ceiling = 0.45 * sampleRate_;
    if (hz > ceiling) hz = ceiling;
    const double w0 = 2.0 * kPi * hz / sampleRate_;
    const double cosW = std::cos(w0);
    const double alpha = std::sin(w0) / (2.0 * 0.7071067811865476);
    const double a0 = 1.0 + alpha;
    b0_ = (1.0 - cosW) * 0.5 / a0;
    b1_ = (1.0 - cosW) / a0;
    b2_ = b0_;
    a1_ = -2.0 * cosW / a0;
    a2_ = (1.0 - alpha) / a0;
}

void DriveProcessor::process(float* buffer, int32_t numFrames) {
    const int32_t selected = static_cast<int32_t>(type_);

    for (int32_t n = 0; n < numFrames; ++n) {
        float in = buffer[n];
        // NaN, +inf and -inf all become zero, as do values too small to matter.
        if (!std::isfinite(in) || std::fabs(in) < kFlush) in = 0.0f;
        const double x = in;

        // Tighten.
        const double tightened = tightenA_ * (tightenY1_ + x - tightenX1_);
        tightenX1_ = x;
        tightenY1_ = flush(tightened);

        // Gain, and the level match that goes with it. Deliberate: match and gain
        // are both linear, so applying the match here, before the DC blocker,
        // is equivalent to spec §3.3's order except during a gain glide — and it
        // lets each curve carry its own match through the crossfade above.
        const float gainDb = gainDb_.next();
        if (gainDb != gainDbForCache_) {
            gainDbForCache_ = gainDb;
            gain_ = std::pow(10.0, static_cast<double>(gainDb) / 20.0);
            for (int32_t i = 0; i < kTypeCount; ++i) match_[i] = levelMatch(static_cast<Type>(i), gain_);
        }
        const double u = tightened * gain_;

        // The crossfade: the selected curve's weight rises, the others fall.
        for (int32_t i = 0; i < kTypeCount; ++i) {
            double w = weight_[i] + (i == selected ? fadeStep_ : -fadeStep_);
            if (w > 1.0 - kWeightSnap) w = 1.0;
            if (w < kWeightSnap) w = 0.0;
            weight_[i] = w;
        }

        // Clip. Only curves with weight are evaluated; all share the same history.
        double wet = 0.0;
        double weightSum = 0.0;
        for (int32_t i = 0; i < kTypeCount; ++i) {
            if (weight_[i] <= 0.0) continue;
            const Type t = static_cast<Type>(i);
            const double c = adaaOn_ ? adaa(t, u, adaaX1_) : curve(t, u);
            wet += weight_[i] * match_[i] * c;
            weightSum += weight_[i];
        }
        adaaX1_ = u;
        const double clipped = weightSum > 0.0 ? wet / weightSum : 0.0;

        // DC blocker.
        const double dc = dcA_ * (dcY1_ + clipped - dcX1_);
        dcX1_ = clipped;
        dcY1_ = flush(dc);

        // TONE.
        const float tone = tone_.next();
        if (std::fabs(tone - toneForCoeffs_) > 1.0e-4f) updateTone(tone);
        const double lp = b0_ * dcY1_ + z1_;
        z1_ = flush(b1_ * dcY1_ - a1_ * lp + z2_);
        z2_ = flush(b2_ * dcY1_ - a2_ * lp);

        // LEVEL.
        buffer[n] = static_cast<float>(flush(lp) * dbToLinear(levelDb_.next()));
    }
}
