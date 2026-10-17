#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * The Drive pedal in the PRE slot, between the input gain and the NAM stages
 * (spec 2026-09-25-drive-effect §3). Per sample: a 100 Hz tightening
 * high-pass, GAIN, a clipping curve with first-order antiderivative
 * anti-aliasing (ADAA), a 10 Hz DC blocker, level matching so GAIN changes the
 * character more than the loudness, a TONE low-pass, then LEVEL.
 *
 * params[0] level, dB (-24..+24): output trim.
 * params[1] gain, dB (+6..+48): into the clipper.
 * params[2] tone, percent (0..100): low-pass cutoff 800 x 15^(tone/100) Hz.
 * params[3] type: 0 SOFT (tanh), 1 HARD (clamp at +-1), 2 ASYM (offset tanh).
 *
 * A type change crossfades over 10 ms by weighting each curve's output, so
 * any sequence of switches, even mid-fade, stays continuous. Every state is a
 * scalar member, so nothing allocates in process().
 */
class DriveProcessor : public Processor {
public:
    enum class Type : int32_t { Soft = 0, Hard = 1, Asym = 2 };
    static constexpr int32_t kTypeCount = 3;

    static constexpr float kMinLevelDb = -24.0f;
    static constexpr float kMaxLevelDb = 24.0f;
    static constexpr float kMinGainDb = 6.0f;
    static constexpr float kMaxGainDb = 48.0f;
    static constexpr float kDefaultGainDb = 27.0f;
    static constexpr float kDefaultTonePercent = 50.0f;

    static constexpr double kTightenHz = 100.0;
    static constexpr double kDcBlockHz = 10.0;
    static constexpr double kToneMinHz = 800.0;
    static constexpr double kToneRatio = 15.0;  // 800 Hz x 15 = 12 kHz
    static constexpr double kAsymBias = 0.4;
    /** The -20 dBFS peak the level matching is aimed at. */
    static constexpr double kLevelReference = 0.1;
    static constexpr double kCrossfadeMs = 10.0;
    static constexpr double kSmoothingMs = 25.0;
    /** Input below this (and NaN or infinity) is treated as zero. */
    static constexpr float kFlush = 1.0e-20f;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

    /** The clipping curve f(x). */
    static double curve(Type type, double x);
    /** Its antiderivative F(x), written so it cannot overflow. */
    static double antiderivative(Type type, double x);
    /** One ADAA step: (F(x) - F(x1)) / (x - x1), or f at the midpoint when they nearly meet. */
    static double adaa(Type type, double x, double x1);
    /** The level-matching factor A / m(g A), m the mean magnitude of the curve at +-g A. */
    static double levelMatch(Type type, double gain);

    /** The selected type, after rounding and clamping. */
    Type type() const { return type_; }
    /** True while a type change is still fading. */
    bool crossfading() const;
    /** Test hook: evaluate the curves directly, to measure what ADAA removes. */
    void setAntiAliasingForTest(bool on) { adaaOn_ = on; }

private:
    void updateTone(float t);

    double sampleRate_ = 48000.0;
    bool primed_ = false;
    bool adaaOn_ = true;

    // One-pole high-passes: y = a (y1 + x - x1).
    double tightenA_ = 0.0;
    double tightenX1_ = 0.0;
    double tightenY1_ = 0.0;
    double dcA_ = 0.0;
    double dcX1_ = 0.0;
    double dcY1_ = 0.0;

    // The previous gained sample, for ADAA. A double: F(x) - F(x1) of two close
    // values loses too much precision in float.
    double adaaX1_ = 0.0;

    // TONE: a biquad low-pass, transposed direct form II, coefficients in double.
    double b0_ = 1.0;
    double b1_ = 0.0;
    double b2_ = 0.0;
    double a1_ = 0.0;
    double a2_ = 0.0;
    double z1_ = 0.0;
    double z2_ = 0.0;
    float toneForCoeffs_ = -1.0f;

    // The gain in linear terms and each curve's level match, recomputed only
    // when the smoothed gain moves.
    float gainDbForCache_ = -1000.0f;
    double gain_ = 1.0;
    double match_[kTypeCount] = {1.0, 1.0, 1.0};

    Type type_ = Type::Soft;
    double weight_[kTypeCount] = {1.0, 0.0, 0.0};
    double fadeStep_ = 1.0;

    SmoothedValue levelDb_;
    SmoothedValue gainDb_;
    SmoothedValue tone_;
};
