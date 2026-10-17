#pragma once

#include <cstdint>

#include "Processor.h"

/**
 * The fixed noise gate: first in the chain, one knob.
 *
 * params[0] of its slice is the threshold in dB. Everything else is fixed and
 * tuned for guitar; a full gate with those as knobs is a separate, movable
 * Phase 3 effect (spec 2026-09-22-fixed-noise-gate §1).
 *
 * Per sample: a peak envelope follower (instant rise, kDetectorFallMs fall)
 * opens the gate above the threshold. It closes only after the envelope has
 * sat below threshold − kHysteresisDb for a continuous kHoldMs. The gain then
 * moves one-pole between unity and kFloorDb — fast to open, slow to close.
 *
 * The threshold is not smoothed: it feeds a comparison, not a gain, so a
 * k-rate step in it cannot zipper.
 */
class GateProcessor : public Processor {
public:
    /** The bottom of gateThreshold's range in params.ts. At or below it, the gate never closes. */
    static constexpr float kThresholdMinDb = -80.0f;
    static constexpr float kHysteresisDb = 6.0f;
    static constexpr double kHoldMs = 10.0;
    static constexpr double kDetectorFallMs = 10.0;
    static constexpr double kOpenMs = 0.5;
    static constexpr double kCloseMs = 100.0;
    static constexpr float kFloorDb = -90.0f;
    /** The envelope is feedback state decaying toward zero: flush it before it goes denormal. */
    static constexpr float kEnvelopeFlush = 1.0e-12f;

    GateProcessor();

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

    bool isOpen() const { return open_; }
    float envelopeForTest() const { return envelope_; }
    float gainForTest() const { return gain_; }

private:
    static constexpr float kGainSnap = 1.0e-7f;

    // Derived in prepare() from the sample rate.
    float envelopeFall_ = 0.0f;
    float openCoeff_ = 1.0f;
    float closeCoeff_ = 1.0f;
    int32_t holdSamples_ = 0;
    float floorGain_ = 0.0f;
    float closeRatio_ = 1.0f;

    // From the threshold param. Open until a real threshold arrives.
    bool alwaysOpen_ = true;
    float openLevel_ = 0.0f;
    float closeLevel_ = 0.0f;

    // Running state, cleared by reset().
    float envelope_ = 0.0f;
    float gain_ = 1.0f;
    bool open_ = true;
    int32_t heldSamples_ = 0;
};
