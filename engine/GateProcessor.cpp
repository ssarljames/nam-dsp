#include "GateProcessor.h"

#include <cmath>

namespace {

// Not dbToLinear() from DspMath.h: that reads anything at or below −60 dB as a
// mute and returns 0, and most useful gate thresholds live below −60 dB.
float dbToAmplitude(float db) { return std::pow(10.0f, db * 0.05f); }

float onePoleCoeff(double timeConstantMs, double sampleRate) {
    return static_cast<float>(1.0 - std::exp(-1.0 / (timeConstantMs * 0.001 * sampleRate)));
}

}  // namespace

GateProcessor::GateProcessor() {
    // Usable before prepare(), like the other stages.
    prepare(48000.0, 128);
}

void GateProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    envelopeFall_ = static_cast<float>(std::exp(-1.0 / (kDetectorFallMs * 0.001 * sampleRate)));
    openCoeff_ = onePoleCoeff(kOpenMs, sampleRate);
    closeCoeff_ = onePoleCoeff(kCloseMs, sampleRate);
    holdSamples_ = static_cast<int32_t>(kHoldMs * 0.001 * sampleRate);
    floorGain_ = dbToAmplitude(kFloorDb);
    closeRatio_ = dbToAmplitude(-kHysteresisDb);
    reset();
}

void GateProcessor::reset() {
    // Fully open, so engaging the gate never starts closed and swallows the
    // first note. If the input is below threshold it closes in its own time.
    envelope_ = 0.0f;
    gain_ = 1.0f;
    open_ = true;
    heldSamples_ = 0;
}

void GateProcessor::setParams(const float* params) {
    const float db = params[0];
    // Written as !(db > min) so a NaN also lands here: a bad value fails open.
    alwaysOpen_ = !(db > kThresholdMinDb);
    if (alwaysOpen_) return;
    openLevel_ = dbToAmplitude(db);
    closeLevel_ = openLevel_ * closeRatio_;
}

void GateProcessor::process(float* buffer, int32_t numFrames) {
    for (int32_t i = 0; i < numFrames; ++i) {
        const float magnitude = std::fabs(buffer[i]);
        envelope_ = magnitude > envelope_ ? magnitude : envelope_ * envelopeFall_;
        if (envelope_ < kEnvelopeFlush) envelope_ = 0.0f;

        if (alwaysOpen_) {
            open_ = true;
            heldSamples_ = 0;
        } else if (!open_) {
            if (envelope_ > openLevel_) {
                open_ = true;
                heldSamples_ = 0;
            }
        } else if (envelope_ >= closeLevel_) {
            heldSamples_ = 0;
        } else if (++heldSamples_ >= holdSamples_) {
            open_ = false;
        }

        const float target = open_ ? 1.0f : floorGain_;
        const float delta = target - gain_;
        if (std::fabs(delta) < kGainSnap) {
            gain_ = target;
        } else {
            const float stepped = gain_ + (delta > 0.0f ? openCoeff_ : closeCoeff_) * delta;
            // Same float32 stall guard as SmoothedValue: once a step rounds
            // away to nothing, the move is over.
            gain_ = stepped == gain_ ? target : stepped;
        }

        buffer[i] *= gain_;
    }
}
