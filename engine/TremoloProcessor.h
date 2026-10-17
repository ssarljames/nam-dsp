#pragma once

#include <cstdint>

#include "Processor.h"
#include "SmoothedValue.h"

/**
 * A mono tremolo, among the POST effects between the cab and the EQ (spec
 * 2026-10-06-tremolo-effect §3.5): the volume rises and falls in time.
 *
 * params[0] level, dB (-24..+24): output trim, to make up what the tremolo takes.
 * params[1] rate, Hz (0.5..15): cycles per second.
 * params[2] depth, percent (0..100): how far the volume falls at the bottom.
 * params[3] wave: 0 SINE, 1 TRI, 2 SQUARE, 3 SAW. Rounded and clamped.
 *
 * Per sample, a phase in cycles gives u, 0 at full volume and 1 at the bottom
 * of the wave; u passes a 2 ms one-pole so the square's and the saw's jumps,
 * and a wave change mid-cycle, become ramps that never click; the output is
 * x * level * (1 - depth * u). It only ever turns down. Every state is a
 * scalar member, so nothing allocates in process().
 */
class TremoloProcessor : public Processor {
public:
    enum class Wave : int32_t { Sine = 0, Triangle = 1, Square = 2, Saw = 3 };
    static constexpr int32_t kWaveCount = 4;

    static constexpr float kMinLevelDb = -24.0f;
    static constexpr float kMaxLevelDb = 24.0f;
    static constexpr float kMinRateHz = 0.5f;
    static constexpr float kMaxRateHz = 15.0f;
    static constexpr float kDefaultRateHz = 4.0f;
    static constexpr float kDefaultDepthPercent = 50.0f;

    static constexpr double kLevelSmoothingMs = 20.0;
    static constexpr double kRateSmoothingMs = 50.0;
    /** The time constant that softens the square's and the saw's edges. */
    static constexpr double kEdgeSmoothingMs = 2.0;

    void prepare(double sampleRate, int32_t maxBlockSize) override;
    void reset() override;
    void setParams(const float* params) override;
    void process(float* buffer, int32_t numFrames) override;

private:
    /** u at `phase` (0..1): 0 is full volume, 1 the bottom of the wave. */
    static float shape(Wave wave, double phase);

    double sampleRate_ = 48000.0;
    /** Where the wave is, in cycles (0..1). A double, so it does not drift. */
    double phase_ = 0.0;
    Wave wave_ = Wave::Sine;

    // False after prepare() and reset(). The chain only calls setParams() on
    // an enabled stage, so a stage that has just been switched on holds stale
    // targets; the first setParams() after a reset snaps to the real ones.
    bool primed_ = false;

    SmoothedValue levelDb_;
    SmoothedValue rate_;
    SmoothedValue depth_;
    /** u through the edge smoother. */
    SmoothedValue edge_;
};
