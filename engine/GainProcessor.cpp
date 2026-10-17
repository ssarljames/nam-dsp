#include "GainProcessor.h"

#include "DspMath.h"

void GainProcessor::prepare(double sampleRate, int32_t /*maxBlockSize*/) {
    gain_.prepare(sampleRate, kSmoothingMs);
    gain_.snapTo(1.0f);
}

void GainProcessor::reset() {
    gain_.snapTo(gain_.target());
}

void GainProcessor::setParams(const float* params) {
    gain_.setTarget(dbToLinear(params[0]));
}

void GainProcessor::process(float* buffer, int32_t numFrames) {
    for (int32_t i = 0; i < numFrames; ++i) {
        buffer[i] *= gain_.next();
    }
}
