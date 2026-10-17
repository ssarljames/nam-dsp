#pragma once

#include <cstdint>
#include <vector>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * A mono reverb with six types, in POST beside the chorus and the delay (spec
 * 2026-10-01-reverb-effect §3). Every type shares one core: a pre-delay, four
 * input diffusers and a feedback delay network of eight damped, modulated
 * lines mixed by a Hadamard matrix. Each type voices that core and adds one
 * small add-on: early reflections (ROOM), spring lines (SPRING), an octave-up
 * shifter inside the loop (SHIMMER) or bloom diffusers in front of it
 * (AMBIENT).
 *
 * params[0] mix, percent (0..100): up to 50 the reverb is added to a full dry
 *           signal; above it the dry falls away, to wet only at 100.
 * params[1] decay, percent (0..100): mapped to the type's own RT60 range.
 * params[2] tone, percent (0..100): the input bandwidth, and how much faster
 *           than DECAY the highs die away.
 * params[3] pre-delay, ms (0..250).
 * params[4] the type's knob, percent (0..100): EARLY, MOD, MOD, DRIP, SHIMMER, BLOOM.
 * params[5] type: 0 ROOM, 1 HALL, 2 PLATE, 3 SPRING, 4 SHIMMER, 5 AMBIENT.
 *
 * A type change fades the wet out over 30 ms, clears the tank and voices the
 * new type, so the tail restarts without a click. With the input closed
 * (trails, §3.4) the dry passes at full level, nothing new enters, and once
 * the tail is below -120 dBFS for 100 ms process() returns at once.
 *
 * The buffers are vectors sized once in the constructor for 96 kHz and never
 * resized, so nothing allocates in process() and an Engine on a test's stack
 * does not carry a megabyte inline.
 */
class ReverbProcessor : public Processor {
public:
    enum class Type : int32_t { Room = 0, Hall = 1, Plate = 2, Spring = 3, Shimmer = 4, Ambient = 5 };
    static constexpr int32_t kTypeCount = 6;
    static constexpr int32_t kLineCount = 8;

    static constexpr float kMaxPreDelayMs = 250.0f;
    static constexpr float kDefaultMixPercent = 30.0f;
    static constexpr float kDefaultDecayPercent = 50.0f;
    static constexpr float kDefaultTonePercent = 50.0f;
    static constexpr float kDefaultPreDelayMs = 20.0f;
    static constexpr float kDefaultCharacterPercent = 50.0f;
    static constexpr Type kDefaultType = Type::Hall;

    static constexpr double kTypeFadeMs = 30.0;
    static constexpr double kInputFadeMs = 5.0;
    static constexpr double kMixSmoothingMs = 20.0;
    static constexpr double kPreDelaySmoothingMs = 50.0;
    static constexpr double kControlSmoothingMs = 40.0;
    static constexpr double kIdleAfterMs = 100.0;
    /** -120 dBFS: below this for kIdleAfterMs, a closed reverb stops running. */
    static constexpr float kIdleThreshold = 1.0e-6f;
    /** Anything written back below this (and NaN or infinity on input) is zero. */
    static constexpr float kFlush = 1.0e-20f;

    /** Samples between coefficient updates. */
    static constexpr int32_t kControlInterval = 32;

    // Buffer sizes, all powers of two so reads wrap with a mask, all sized for 96 kHz.
    static constexpr int32_t kTankLineSize = 16384;
    static constexpr int32_t kPreDelaySize = 32768;
    static constexpr int32_t kDiffuserSize = 2048;
    static constexpr int32_t kBloomSize = 16384;
    static constexpr int32_t kShifterSize = 8192;
    static constexpr int32_t kSpringLineSize = 8192;
    static constexpr int32_t kDispersionSize = 32;

    static constexpr int32_t kDiffuserCount = 4;
    static constexpr int32_t kBloomCount = 4;
    static constexpr int32_t kShifterCount = kLineCount;  // every tank line is shifted
    static constexpr int32_t kSpringCount = 2;
    static constexpr int32_t kDispersionStages = 12;
    static constexpr int32_t kEarlyTapCount = 8;

    ReverbProcessor();

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

    /**
     * Trails (spec §3.4): with the input closed the dry passes at full level,
     * nothing new enters the tank, and the tail rings out. Opening it wakes the
     * processor without a reset. Open by default.
     */
    void setInputOpen(bool open);
    bool inputOpen() const { return inputOpen_; }

    /** True once a closed reverb's tail has stayed below -120 dBFS for 100 ms. */
    bool idle() const { return idle_; }

    /** The type the tank is voiced for now. Lags a TYPE change by its fade. */
    Type type() const { return voiced_; }

    /** RT60 in seconds for `type` at `decayPercent` (0..100): lo x (hi / lo)^(d / 100). */
    static double decaySeconds(Type type, double decayPercent);

    /** How one type voices the shared core. Defined in the .cpp; public only so its table can be. */
    struct Voice;

private:
    static const Voice& voiceOf(Type type);

    void clearState();
    void voice(Type type);
    void updateControls();

    double sampleRate_ = 48000.0;
    bool primed_ = false;
    bool inputOpen_ = true;
    bool idle_ = false;
    int32_t quietSamples_ = 0;
    int32_t idleAfterSamples_ = 4800;

    Type voiced_ = kDefaultType;
    Type requested_ = kDefaultType;
    float fade_ = 1.0f;
    float fadeStep_ = 0.0f;
    int32_t controlCountdown_ = 0;

    // Smoothed per sample.
    SmoothedValue wetGain_;
    SmoothedValue dryGain_;
    SmoothedValue inputGain_;
    SmoothedValue preDelay_;  // in samples
    // Smoothed once per control interval.
    SmoothedValue decay_;      // percent
    SmoothedValue tone_;       // percent
    SmoothedValue character_;  // 0..1
    float mixTarget_ = kDefaultMixPercent * 0.01f;

    // Derived once per control interval.
    float lineGain_[kLineCount] = {};  // the decay gain at DC
    float dampA_[kLineCount] = {};     // the one-pole that makes the highs die faster
    float bandwidthA_ = 0.0f;
    float modDepth_ = 0.0f;  // samples
    float outGain_ = 1.0f;
    float early_ = 0.0f;
    float shimmer_ = 0.0f;
    float bloomG_ = 0.0f;
    float bloomMix_ = 0.0f;
    float springA_ = 0.0f;
    float springGain_[kSpringCount] = {};
    float springDampA_[kSpringCount] = {};
    float lowCutA_ = 0.0f;

    // Fixed for the voiced type and the sample rate.
    float lineLength_[kLineCount] = {};  // samples
    float lfoPhase_[kLineCount] = {};    // cycles, 0..1
    float lfoStep_[kLineCount] = {};
    int32_t diffuserLength_[kDiffuserCount] = {};
    float diffusion_ = 0.0f;
    int32_t bloomLength_[kBloomCount] = {};
    float shifterWindow_ = 0.0f;  // samples
    float shifterPhase_ = 0.0f;   // cycles, 0..1
    float shifterStep_ = 0.0f;
    int32_t springLength_[kSpringCount] = {};
    int32_t dispersionK_ = 1;
    float earlyDelay_[kEarlyTapCount] = {};  // samples after the pre-delay
    float maxPreDelay_ = 0.0f;               // samples

    // Filter states.
    float bandwidthZ_ = 0.0f;
    float dampZ_[kLineCount] = {};
    float springDampZ_[kSpringCount] = {};
    float lowCutX1_ = 0.0f;
    float lowCutY1_ = 0.0f;

    // Lines. One write index per kind of buffer, shared by its lines.
    std::vector<float> tank_;
    std::vector<float> preDelayLine_;
    std::vector<float> diffusers_;
    std::vector<float> bloom_;
    std::vector<float> shifters_;
    std::vector<float> springs_;
    std::vector<float> dispersion_;
    int32_t tankWrite_ = 0;
    int32_t preDelayWrite_ = 0;
    int32_t diffuserWrite_ = 0;
    int32_t bloomWrite_ = 0;
    int32_t shifterWrite_ = 0;
    int32_t springWrite_ = 0;
    int32_t dispersionWrite_ = 0;
};
