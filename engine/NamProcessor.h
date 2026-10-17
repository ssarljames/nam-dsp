#pragma once

#include <cstdint>
#include <memory>

#include "Processor.h"
#include "SmoothedValue.h"

// Forward-declared so this header stays free of Eigen and nlohmann, which
// would otherwise be pulled into every translation unit that touches the
// chain — including the host test build.
namespace nam {
class DSP;
}

/**
 * One NAM model stage in the chain.
 *
 * Loads arrive in the worklet's message handler, which runs on the audio
 * thread between quanta — the same thread as process(), never overlapping it.
 * The double buffer in loadFrom() is therefore not about concurrency; it makes
 * a load transactional. A rejected or partial load never touches the model
 * process() is currently using, and taking a new one live is a single pointer
 * write, done only after the replacement is fully built.
 *
 * loadFrom() DOES allocate and can throw — building a WaveNet from JSON is
 * measured at 55-78 ms, which is roughly 25 quanta. That cost is inherent to
 * model loading and is why the caller should silence the stage across a load.
 * process() itself allocates nothing.
 *
 * params[0] of its pool slice is the stage's engaged level in dB, applied after
 * the model — and applied with no model loaded too, so the knob means one thing
 * whenever the stage is on.
 */
class NamProcessor : public Processor {
public:
    /** Largest payload this stage accepts. Mirrored by Engine::kMaxModelBytes. */
    static constexpr int32_t kMaxModelBytes = 8 * 1024 * 1024;

    /** The render quantum; the scratch buffer is sized for it. */
    static constexpr int32_t kMaxBlockSize = 128;

    NamProcessor();
    ~NamProcessor() override;

    void process(float* buffer, int32_t numFrames) override;
    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;

    /**
     * Parses `bytes` as a .nam document and builds a model into the inactive
     * slot, then swaps the active pointer. Returns false — leaving the active
     * model in place — for a null, empty or oversized payload, or one the
     * library refuses.
     */
    bool loadFrom(const uint8_t* bytes, int32_t byteLength);

    bool hasModel() const { return active_ != nullptr; }
    int32_t modelByteLength() const { return active_ != nullptr ? active_->byteLength : 0; }

    /** The rate the loaded model was trained at, or 0 when nothing is loaded. */
    double modelSampleRate() const;

    /** Identity of the active slot, so a test can prove the swap happened. */
    const void* activeModelForTest() const { return active_; }

private:
    struct Model {
        std::unique_ptr<nam::DSP> dsp;
        int32_t byteLength = 0;
        double sampleRate = 0.0;
    };

    Model slots_[2];
    Model* active_ = nullptr;
    int nextSlot_ = 0;

    double sampleRate_ = 48000.0;
    int32_t maxBlock_ = kMaxBlockSize;

    static constexpr double kLevelSmoothingMs = 20.0;
    // Per sample: a k-rate step straight into a gain is zipper noise.
    SmoothedValue level_;

    // NAM writes its output to a separate buffer rather than in place, so the
    // stage owns one. Fixed size: nothing is allocated on the audio path.
    float scratch_[kMaxBlockSize] = {};
};
