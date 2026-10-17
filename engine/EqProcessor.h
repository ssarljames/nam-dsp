#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * Normalised biquad coefficients (a0 divided out).
 *
 * `double`, not `float`, and that is load-bearing. At a 100 Hz corner and
 * 48 kHz, a0+a1+a2 collapses to 4(1-cos w0) ~ 3.4e-4 while the individual
 * coefficients are O(3) — about four decimal digits cancel. float32 carries
 * ~7.2 digits, so roughly three survive, leaving the DC response accurate to
 * only ~1e-3 relative. Storing them in double drops that error to ~1e-12.
 *
 * The audible error at float32 was tiny (0.026 dB), but the same
 * ill-conditioning governs the pole placement of every low-frequency biquad in
 * this chain, and double costs nothing here: three biquads over a 128-frame
 * quantum.
 */
struct BiquadCoeffs {
    double b0 = 1.0;
    double b1 = 0.0;
    double b2 = 0.0;
    double a1 = 0.0;
    double a2 = 0.0;
};

// RBJ Audio EQ Cookbook, shelving slope S = 1.
BiquadCoeffs makeLowShelf(double freqHz, double sampleRate, double gainDb);
BiquadCoeffs makePeaking(double freqHz, double q, double sampleRate, double gainDb);
BiquadCoeffs makeHighShelf(double freqHz, double sampleRate, double gainDb);

/**
 * Transposed Direct Form II — two state words. State is `double` to match the
 * coefficients; see BiquadCoeffs for why single precision is not enough at a
 * 100 Hz corner.
 */
struct Biquad {
    BiquadCoeffs c;
    double z1 = 0.0;
    double z2 = 0.0;

    inline double process(double x) {
        const double y = c.b0 * x + z1;
        z1 = c.b1 * x - c.a1 * y + z2;
        z2 = c.b2 * x - c.a2 * y;
        return y;
    }

    void reset() {
        z1 = 0.0;
        z2 = 0.0;
    }
};

/**
 * Three-band tone stack with an engaged output level. params[0] = bass dB,
 * params[1] = mid dB, params[2] = treble dB, each in [-12, +12]; params[3] =
 * level dB in [-24, +24], applied after the bands.
 *
 * Band gains smooth at block rate rather than per sample: recomputing three
 * sets of biquad coefficients 48000 times a second would be absurd, and a
 * 2.67 ms step in a 30 ms glide is inaudible on a filter coefficient. The
 * level is different — it is a plain multiply — so it smooths per sample.
 */
class EqProcessor : public Processor {
public:
    /** Tone bands in this processor's slice: bass, mid, treble. */
    static constexpr int32_t kBandCount = 3;

    /** Everything it consumes from its slice: the bands, then the level. */
    static constexpr int32_t kParamCount = kBandCount + 1;

    static constexpr double kBassFreq = 100.0;
    static constexpr double kMidFreq = 800.0;
    static constexpr double kMidQ = 0.7;
    static constexpr double kTrebleFreq = 3200.0;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

private:
    static constexpr double kSmoothingMs = 30.0;
    static constexpr double kLevelSmoothingMs = 20.0;
    /** Below this much movement in dB, the coefficients are not worth recomputing. */
    static constexpr float kRecomputeEpsilonDb = 0.01f;

    void updateCoefficients();

    double sampleRate_ = 48000.0;
    SmoothedValue bassDb_, midDb_, trebleDb_;
    float lastBassDb_ = 0.0f, lastMidDb_ = 0.0f, lastTrebleDb_ = 0.0f;
    Biquad bass_, mid_, treble_;
    // Per sample, unlike the bands: a k-rate step straight into a gain is
    // exactly the zipper noise the project's smoothing rule exists to prevent.
    SmoothedValue level_;
};
