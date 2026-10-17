#pragma once

#include <cstdint>

class Processor {
public:
    virtual ~Processor() = default;

    // Contract: RT-safe. No allocation, locks, or exceptions.
    virtual void process(float* buffer, int32_t numFrames) = 0;

    // Allocates everything this processor will ever need. Called off the audio
    // thread, before the chain runs.
    virtual void prepare(double sampleRate, int32_t maxBlockSize) = 0;

    // Clears delay lines and filter state. Called on sample-rate change and on
    // chain reorder, so a stale tail cannot leak into a new chain position.
    virtual void reset() = 0;

    // Receives the k-rate parameter slice belonging to this processor's slot.
    virtual void setParams(const float* params) = 0;

    bool enabled = true;
};
