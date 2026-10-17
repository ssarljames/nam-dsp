#pragma once

#include <cassert>
#include <cstdint>
#include <vector>

#include "Processor.h"

/**
 * The ordered chain, run from the single audio callback.
 *
 * Membership is established once at engine construction. `process()` never
 * inserts, removes, constructs or destroys anything — a reorder permutes
 * these entries (swapEntries) and enable/disable flips Processor::enabled.
 */
class ProcessorChain {
public:
    static constexpr int kMaxEntries = 16;

    ProcessorChain() { entries_.reserve(kMaxEntries); }

    /** Setup time only. Never call this from process(). */
    void add(Processor* processor, int paramOffset);

    void prepare(double sampleRate, int32_t maxBlockSize);
    void reset();

    /** RT-safe. `paramBlock` is the whole k-rate block; each entry gets a slice. */
    void process(float* buffer, int32_t numFrames, const float* paramBlock);

    int size() const { return static_cast<int>(entries_.size()); }
    Processor* at(int index) const {
        assert(index >= 0 && index < size() && "ProcessorChain::at: index out of range");
        return entries_[static_cast<size_t>(index)].processor;
    }

    /** The parameter offset the entry at `index` was added with. */
    int paramOffsetAt(int index) const {
        assert(index >= 0 && index < size() && "ProcessorChain::paramOffsetAt: index out of range");
        return entries_[static_cast<size_t>(index)].paramOffset;
    }

    /**
     * Swaps the entries at `i` and `j`; each keeps its own parameter offset,
     * so a moved processor still reads its own slice. False, and nothing
     * changes, if either index is out of range. Allocates nothing: call it
     * between render quanta, never from process(). It does not reset the moved
     * processors; the caller decides that.
     */
    bool swapEntries(int i, int j);

private:
    struct Entry {
        Processor* processor;
        int paramOffset;
    };

    std::vector<Entry> entries_;
};
