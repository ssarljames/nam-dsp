#include "NamProcessor.h"

#include <cstring>
#include <string>

#include "NAM/dsp.h"
#include "NAM/get_dsp.h"

#include "DspMath.h"

NamProcessor::NamProcessor() {
    // Unity before prepare(), so a stage processed before it is prepared is
    // transparent rather than silent.
    level_.snapTo(1.0f);
}

// Out of line because Model holds a unique_ptr<nam::DSP> and nam::DSP is
// incomplete in the header.
NamProcessor::~NamProcessor() = default;

void NamProcessor::process(float* buffer, int32_t numFrames) {
    const int32_t frames = numFrames > kMaxBlockSize ? kMaxBlockSize : numFrames;
    if (frames <= 0) return;

    const Model* model = active_;
    if (model != nullptr && model->dsp) {
        float* in = buffer;
        float* out = scratch_;
        model->dsp->process(&in, &out, static_cast<int>(frames));
        std::memcpy(buffer, scratch_, static_cast<size_t>(frames) * sizeof(float));
    }

    // With no model the stage is transparent, but its level still applies.
    for (int32_t i = 0; i < frames; ++i) buffer[i] *= level_.next();
}

void NamProcessor::prepare(double sampleRate, int32_t maxBlockSize) {
    sampleRate_ = sampleRate;
    maxBlock_ = maxBlockSize > kMaxBlockSize ? kMaxBlockSize : maxBlockSize;
    for (Model& slot : slots_) {
        if (slot.dsp) slot.dsp->Reset(sampleRate_, static_cast<int>(maxBlock_));
    }

    level_.prepare(sampleRate, kLevelSmoothingMs);
    level_.snapTo(1.0f);
}

void NamProcessor::reset() {
    if (active_ != nullptr && active_->dsp) {
        active_->dsp->Reset(sampleRate_, static_cast<int>(maxBlock_));
    }

    level_.snapTo(level_.target());
}

void NamProcessor::setParams(const float* params) {
    level_.setTarget(dbToLinear(params[0]));
}

double NamProcessor::modelSampleRate() const {
    return active_ != nullptr ? active_->sampleRate : 0.0;
}

bool NamProcessor::loadFrom(const uint8_t* bytes, int32_t byteLength) {
    if (bytes == nullptr) return false;
    if (byteLength <= 0) return false;
    if (byteLength > kMaxModelBytes) return false;

    // Build into the slot that is NOT live, so the model process() is using
    // stays whole if anything below fails.
    Model& target = slots_[nextSlot_];

    try {
        const std::string text(reinterpret_cast<const char*>(bytes),
                               static_cast<size_t>(byteLength));
        const nlohmann::json config = nlohmann::json::parse(text);
        const double rate = nam::get_sample_rate_from_nam_file(config);
        std::unique_ptr<nam::DSP> dsp = nam::get_dsp(config);
        if (!dsp) return false;
        dsp->Reset(sampleRate_, static_cast<int>(maxBlock_));

        target.dsp = std::move(dsp);
        target.byteLength = byteLength;
        target.sampleRate = rate;
    } catch (...) {
        // A malformed or unsupported model leaves the active one untouched.
        return false;
    }

    active_ = &target;
    nextSlot_ = 1 - nextSlot_;
    return true;
}
